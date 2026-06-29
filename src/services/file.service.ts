import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import * as auditService from "./audit.service";
import {
  createFile,
  getFileById,
  getFilesByUser,
  deleteFile as deleteFileFromStore,
  StoredFile,
} from "../db/fileStore";
import { requireFileAccess } from "../utils/accessControl";

export interface UploadResult {
  file: StoredFile;
}

const MAX_USER_STORAGE_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB
// #37 - Per-user file count limit to prevent resource exhaustion
const MAX_USER_FILE_COUNT = 1000;

export async function uploadFile(
  userId: string,
  multerFile: Express.Multer.File,
  options: { isEncrypted?: boolean; originalMimeType?: string } = {},
): Promise<UploadResult> {
  const existingFiles = await getFilesByUser(userId);
  
  // #37 - Check file count limit
  if (existingFiles.length >= MAX_USER_FILE_COUNT) {
    if (fs.existsSync(multerFile.path)) fs.unlinkSync(multerFile.path);
    throw new Error(`File count limit exceeded (${MAX_USER_FILE_COUNT} files maximum).`);
  }
  
  // #62 - Per-user storage quota to prevent disk exhaustion
  const totalBytes = existingFiles.reduce((acc, f) => acc + f.size, 0);
  if (totalBytes + multerFile.size > MAX_USER_STORAGE_BYTES) {
    if (fs.existsSync(multerFile.path)) fs.unlinkSync(multerFile.path);
    throw new Error("Storage quota exceeded (1GB limit).");
  }

  const fileId = uuidv4();
  const stored = await createFile({
    id: fileId,
    userId,
    originalName: multerFile.originalname,
    mimeType: options.originalMimeType ?? multerFile.mimetype,
    size: multerFile.size,
    diskPath: multerFile.path,
    publicUrl: `/api/files/${fileId}/download`,
    adminOnlyChat: false,
    createdAt: new Date(),
    isEncrypted: options.isEncrypted ?? false,
  });

  auditService.logAction(fileId, userId, "upload", `Uploaded file ${multerFile.originalname}`);

  return { file: stored };
}

export async function listFiles(userId: string): Promise<StoredFile[]> {
  return getFilesByUser(userId);
}

export async function downloadFile(
  fileId: string,
  requestingUserId: string,
): Promise<{ stream: fs.ReadStream; file: StoredFile }> {
  const { file } = await requireFileAccess(fileId, requestingUserId, "download");

  if (!fs.existsSync(file.diskPath)) throw new Error("File no longer exists on disk.");

  auditService.logAction(fileId, requestingUserId, "download", `Downloaded ${file.originalName}`);

  return { stream: fs.createReadStream(file.diskPath), file };
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
  stream: fs.ReadStream;
  originalName: string;
  mimeType: string;
  size: number;
}> {
  const { file: stored } = await requireFileAccess(fileId, requestingUserId, "view");
  if (!fs.existsSync(stored.diskPath)) throw new Error("File no longer exists on disk.");

  return {
    stream: fs.createReadStream(stored.diskPath),
    originalName: stored.originalName,
    mimeType: stored.mimeType,
    size: stored.size,
  };
}

export async function streamFileDownloadForShareLink(
  fileId: string,
): Promise<{
  stream: fs.ReadStream;
  originalName: string;
  mimeType: string;
  size: number;
}> {
  const stored = await getFileById(fileId);
  if (!stored) {
    throw new Error("File not found.");
  }

  if (!fs.existsSync(stored.diskPath)) throw new Error("File no longer exists on disk.");

  return {
    stream: fs.createReadStream(stored.diskPath),
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
): Promise<StoredFile> {
  const file = await getFileById(fileId);
  if (!file) throw new Error("File not found.");
  if (file.userId !== requestingUserId) throw new Error("Access denied.");

  if (fs.existsSync(file.diskPath)) {
    fs.unlinkSync(file.diskPath);
  }

  await deleteFileFromStore(fileId);

  auditService.logAction(fileId, requestingUserId, "delete", `Deleted ${file.originalName}`);

  return file;
}

export async function getFileDetails(
  fileId: string,
  requestingUserId: string,
): Promise<StoredFile> {
  // Owner or any user the file is shared with may view its details.
  const { file } = await requireFileAccess(fileId, requestingUserId, "view");

  auditService.logAction(fileId, requestingUserId, "view", `Viewed ${file.originalName}`);

  return file;
}
