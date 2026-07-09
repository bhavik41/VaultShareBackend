import OpenAI from "openai";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const pdfParse = require("pdf-parse") as (buf: Buffer) => Promise<{ text: string; numpages: number }>;
// mammoth has no @types package — use require
// eslint-disable-next-line @typescript-eslint/no-require-imports
const mammoth = require("mammoth") as { extractRawText: (opts: { buffer: Buffer }) => Promise<{ value: string }> };

import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
import { FileModel } from "../models/File";
import { DocumentChunkModel } from "../models/DocumentChunk";
import { getActiveVersion } from "../db/fileVersionStore";
import { getObjectStream } from "./s3.service";

// ─── Stop words (common English words with no search value) ─────────────────

const STOP_WORDS = new Set([
  "a","an","the","and","or","but","in","on","at","to","for","of","with",
  "by","from","up","as","is","was","are","were","be","been","being","have",
  "has","had","do","does","did","will","would","could","should","may","might",
  "shall","can","need","that","this","these","those","it","its","i","you",
  "he","she","we","they","me","him","her","us","them","my","your","his",
  "our","their","what","which","who","when","where","how","all","each","if",
  "not","no","so","than","then","there","about","into","through","during",
  "before","after","above","below","between","out","off","over","under",
  "again","any","both","more","most","other","some","such","only","own",
  "same","just","because","also","very","much","well","even","still","back",
]);

// ─── Text extraction ─────────────────────────────────────────────────────────

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function extractText(s3Key: string, mimeType: string): Promise<string> {
  const stream = await getObjectStream(s3Key);
  const buffer = await streamToBuffer(stream);

  if (mimeType === "application/pdf") {
    const result = await pdfParse(buffer);
    return result.text;
  }

  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mimeType === "application/msword"
  ) {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  if (mimeType.startsWith("text/") || mimeType === "application/json") {
    return buffer.toString("utf-8");
  }

  throw new Error(`Unsupported file type for Q&A: ${mimeType}. Supported types: PDF, Word (.docx), plain text.`);
}

// ─── Chunking ────────────────────────────────────────────────────────────────

const CHUNK_SIZE = 500;   // target words per chunk
const CHUNK_OVERLAP = 50; // words of overlap between consecutive chunks

function chunkText(text: string): string[] {
  // Normalise whitespace
  const clean = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").trim();
  const words = clean.split(/\s+/);

  if (words.length === 0) return [];

  const chunks: string[] = [];
  let start = 0;

  while (start < words.length) {
    const end = Math.min(start + CHUNK_SIZE, words.length);
    chunks.push(words.slice(start, end).join(" "));
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

// ─── BM25 retrieval ──────────────────────────────────────────────────────────

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function bm25Scores(
  query: string,
  chunks: { text: string; wordCount: number }[],
): number[] {
  const k1 = 1.5;
  const b = 0.75;
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0) return chunks.map(() => 0);

  const avgLen = chunks.reduce((s, c) => s + c.wordCount, 0) / (chunks.length || 1);

  return chunks.map(({ text, wordCount }) => {
    const tokens = tokenize(text);
    const freq: Record<string, number> = {};
    tokens.forEach((t) => { freq[t] = (freq[t] ?? 0) + 1; });

    return queryTokens.reduce((score, qt) => {
      const tf = freq[qt] ?? 0;
      if (tf === 0) return score;
      return score + (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * wordCount / avgLen));
    }, 0);
  });
}

// ─── Indexing ────────────────────────────────────────────────────────────────

async function indexDocument(fileId: string, s3Key: string, mimeType: string): Promise<void> {
  const text = await extractText(s3Key, mimeType);
  const chunks = chunkText(text);

  const nonEmpty = chunks.filter((c) => c.trim().length > 0);
  if (nonEmpty.length === 0) throw new Error("Could not extract any readable text from this document. It may be a scanned image-based PDF — try uploading a text-based PDF or a .docx file.");
  const chunks2 = nonEmpty;

  // Delete existing chunks for this file and re-index
  await DocumentChunkModel.deleteMany({ fileId });

  const docs = chunks2.map((chunkText, i) => ({
    _id: uuidv4(),
    fileId,
    indexedS3Key: s3Key,
    chunkIndex: i,
    text: chunkText,
    wordCount: chunkText.split(/\s+/).length,
  }));

  await DocumentChunkModel.insertMany(docs);
}

// ─── Q&A ─────────────────────────────────────────────────────────────────────

const TOP_K = 6; // number of chunks to send to Claude

const DEMO_ANSWERS = [
  "This is a demo response. In production, the AI reads your actual document and answers based on its content.",
  "Demo mode is active. Add your ANTHROPIC_API_KEY to .env to get real answers from the document.",
  "Great question! With a real API key, the AI would scan the relevant sections of this document and give you a precise answer.",
  "This would normally show a summary extracted from the document's key sections. Add ANTHROPIC_API_KEY to enable real responses.",
];

let _demoIndex = 0;

export async function askQuestion(
  fileId: string,
  question: string,
): Promise<{ answer: string; chunksUsed: number; totalChunks: number }> {
  const isDemoMode = !process.env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY.trim() === "";

  const file = await FileModel.findById(fileId);
  if (!file) throw new Error("File not found.");

  const activeVersion = await getActiveVersion(fileId);
  const s3Key = activeVersion?.s3Key;
  const mimeType = activeVersion?.mimeType ?? file.mimeType;

  if (!s3Key) throw new Error("No active file version found. Cannot answer questions about this file.");

  if (isDemoMode) {
    const answer = DEMO_ANSWERS[_demoIndex % DEMO_ANSWERS.length];
    _demoIndex++;
    return { answer, chunksUsed: 0, totalChunks: 0 };
  }

  // Re-index if file has changed or hasn't been indexed yet
  const existingChunk = await DocumentChunkModel.findOne({ fileId });
  if (!existingChunk || existingChunk.indexedS3Key !== s3Key) {
    await indexDocument(fileId, s3Key, mimeType);
  }

  const allChunks = await DocumentChunkModel.find({ fileId }).sort({ chunkIndex: 1 }).lean();
  if (allChunks.length === 0) throw new Error("Document has no indexed content.");

  // Score and pick top chunks
  const scores = bm25Scores(question, allChunks);
  const ranked = allChunks
    .map((c, i) => ({ chunk: c, score: scores[i] })
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);

  // Sort selected chunks back into document order for better context
  ranked.sort((a, b) => a.chunk.chunkIndex - b.chunk.chunkIndex);
  const contextText = ranked.map((r, i) => `[Section ${i + 1}]\n${r.chunk.text}`).join("\n\n---\n\n");

  const openai = new OpenAI({
    apiKey: process.env.NVIDIA_API_KEY!,
    baseURL: "https://integrate.api.nvidia.com/v1",
  });

  const response = await openai.chat.completions.create({
    model: "meta/llama-3.1-8b-instruct",
    messages: [
      {
        role: "user",
        content: `You are a document Q&A assistant. Answer questions based ONLY on the document sections provided below. If the answer is not found in the sections, say "I couldn't find information about that in this document."

Document: "${file.originalName}"

Relevant sections from the document:
${contextText}

Question: ${question}

Answer concisely and accurately, citing the relevant section when helpful.`,
      },
    ],
    max_tokens: 1024,
  });

  const answer = response.choices[0].message.content ?? "";

  return {
    answer,
    chunksUsed: ranked.length,
    totalChunks: allChunks.length,
  };
}
