import { Storage } from "@google-cloud/storage";
import { v4 as uuidv4 } from "uuid";
import path from "path";
import {
  createFile,
  getFileById,
  getFilesByUser,
  deleteFile as deleteFileFromStore,
  StoredFile,
} from "../db/fileStore";

// ── GCS client ────────────────────────────────────────────────────────────────
// Credentials are loaded from environment variables.
// GCP_KEY_FILE takes priority (path to a service-account JSON).
// Otherwise falls back to individual GOOGLE_* env vars so the credentials can
// be stored directly in .env without putting a JSON file on disk.
function buildStorageClient(): Storage {
  if (process.env.GCP_KEY_FILE) {
    return new Storage({ keyFilename: process.env.GCP_KEY_FILE });
  }

  const projectId = process.env.GCP_PROJECT_ID;
  const clientEmail = process.env.GCP_CLIENT_EMAIL;
  const privateKey = process.env.GCP_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (projectId && clientEmail && privateKey) {
    return new Storage({
      projectId,
      credentials: { client_email: clientEmail, private_key: privateKey },
    });
  }

  // Fallback: Application Default Credentials (works on GCP infra / gcloud auth)
  return new Storage();
}

const storage = buildStorageClient();
const BUCKET_NAME = process.env.GCP_BUCKET_NAME as string;

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildGcsKey(userId: string, originalName: string): string {
  const ext = path.extname(originalName);
  return `uploads/${userId}/${uuidv4()}${ext}`;
}

// ── Service functions ─────────────────────────────────────────────────────────

export interface UploadResult {
  file: StoredFile;
}

/**
 * Upload a file buffer to GCS and persist metadata.
 */
export async function uploadFile(
  userId: string,
  originalName: string,
  mimeType: string,
  buffer: Buffer,
  size: number,
): Promise<UploadResult> {
  if (!BUCKET_NAME) {
    throw new Error("GCP_BUCKET_NAME is not configured.");
  }

  const gcsKey = buildGcsKey(userId, originalName);
  const bucket = storage.bucket(BUCKET_NAME);
  const gcsFile = bucket.file(gcsKey);

  // Upload buffer to GCS
  await gcsFile.save(buffer, {
    metadata: { contentType: mimeType },
    resumable: false,
  });

  // Generate a signed URL valid for 7 days for the uploader to share
  const [signedUrl] = await gcsFile.getSignedUrl({
    action: "read",
    expires: Date.now() + 7 * 24 * 60 * 60 * 1000,
  });

  const fileId = uuidv4();
  const stored = createFile({
    id: fileId,
    userId,
    originalName,
    mimeType,
    size,
    gcsBucket: BUCKET_NAME,
    gcsKey,
    publicUrl: signedUrl,
    createdAt: new Date(),
  });

  return { file: stored };
}

/**
 * List all files uploaded by a user.
 */
export function listFiles(userId: string): StoredFile[] {
  return getFilesByUser(userId);
}

/**
 * Get a fresh short-lived signed URL for a file (sharing / preview use case).
 * The URL is valid for 1 hour and can be handed to anyone.
 */
export async function getSignedUrl(
  fileId: string,
  requestingUserId: string,
): Promise<string> {
  const stored = getFileById(fileId);
  if (!stored) throw new Error("File not found.");
  if (stored.userId !== requestingUserId) throw new Error("Access denied.");

  const [signedUrl] = await storage
    .bucket(stored.gcsBucket)
    .file(stored.gcsKey)
    .getSignedUrl({
      action: "read",
      expires: Date.now() + 60 * 60 * 1000, // 1 hour
    });

  return signedUrl;
}

/**
 * Stream a file directly from GCS to the HTTP response.
 * Returns the GCS ReadStream and file metadata so the controller
 * can set the correct response headers before piping.
 */
export async function streamFileDownload(
  fileId: string,
  requestingUserId: string,
): Promise<{
  stream: NodeJS.ReadableStream;
  originalName: string;
  mimeType: string;
  size: number;
}> {
  const stored = getFileById(fileId);
  if (!stored) throw new Error("File not found.");
  if (stored.userId !== requestingUserId) throw new Error("Access denied.");

  const gcsFile = storage.bucket(stored.gcsBucket).file(stored.gcsKey);

  // Verify the object still exists in GCS before streaming
  const [exists] = await gcsFile.exists();
  if (!exists) throw new Error("File no longer exists in storage.");

  const readStream = gcsFile.createReadStream();

  return {
    stream: readStream,
    originalName: stored.originalName,
    mimeType: stored.mimeType,
    size: stored.size,
  };
}

/**
 * Delete a file from GCS and remove its metadata record.
 */
export async function deleteFile(
  fileId: string,
  requestingUserId: string,
): Promise<void> {
  const stored = getFileById(fileId);
  if (!stored) throw new Error("File not found.");
  if (stored.userId !== requestingUserId) throw new Error("Access denied.");

  await storage
    .bucket(stored.gcsBucket)
    .file(stored.gcsKey)
    .delete({ ignoreNotFound: true });

  deleteFileFromStore(fileId);
}
