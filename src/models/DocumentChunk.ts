import { Schema, model } from "mongoose";

export interface IDocumentChunk {
  _id: string;
  fileId: string;
  indexedS3Key: string;
  chunkIndex: number;
  text: string;
  wordCount: number;
  createdAt: Date;
}

const documentChunkSchema = new Schema<IDocumentChunk>({
  _id: { type: String },
  fileId: { type: String, required: true, index: true },
  indexedS3Key: { type: String, required: true },
  chunkIndex: { type: Number, required: true },
  text: { type: String, required: true },
  wordCount: { type: Number, required: true },
  createdAt: { type: Date, default: () => new Date() },
});

documentChunkSchema.index({ fileId: 1, chunkIndex: 1 });

export const DocumentChunkModel = model<IDocumentChunk>("DocumentChunk", documentChunkSchema);
