import fs from "fs";
import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
import * as s3Service from "./s3.service";
import {
  createFile,
  getFileById,
  getFilesByUser,
  deleteFile as deleteFileFromStore,
  StoredFile,
} from "../db/fileStore";
import {
  createFileVersion,
  getActiveVersion,
  getVersionsByFile,
  deleteVersionsByFile,
  setActiveVersion,
} from "../db/fileVersionStore";
import { requireFileAccess } from "../utils/accessControl";

export interface UploadResult {
  file: StoredFile;
}

export const MAX_USER_STORAGE_BYTES = 1 * 1024 * 1024 * 1024; // 1 GB
// #37 - Per-user file count limit to prevent resource exhaustion
export const MAX_USER_FILE_COUNT = 1000;

export async function uploadFile(
  userId: string,
  multerFile: Express.Multer.File,
  options: { isEncrypted?: boolean; originalMimeType?: string } = {},
): Promise<UploadResult> {
  const existingFiles = await getFilesByUser(userId);

  // #37 - Check file count limit
  if (existingFiles.length >= MAX_USER_FILE_COUNT) {
    throw new Error(`File count limit exceeded (${MAX_USER_FILE_COUNT} files maximum).`);
  }

  // #62 - Per-user storage quota to prevent disk exhaustion
  const totalBytes = existingFiles.reduce((acc, f) => acc + f.size, 0);
  if (totalBytes + multerFile.size > MAX_USER_STORAGE_BYTES) {
    throw new Error("Storage quota exceeded (1GB limit).");
  }

  const fileId = uuidv4();
  const mimeType = options.originalMimeType ?? multerFile.mimetype;
  const isEncrypted = options.isEncrypted ?? false;

  const s3Key = s3Service.buildVersionKey(userId, fileId, 1, multerFile.originalname);
  await s3Service.putObject(s3Key, multerFile.buffer, multerFile.mimetype);

  const stored = await createFile({
    id: fileId,
    userId,
    originalName: multerFile.originalname,
    mimeType,
    size: multerFile.size,
    diskPath: "",
    publicUrl: `/api/files/${fileId}/download`,
    adminOnlyChat: false,
    createdAt: new Date(),
    isEncrypted,
  });

  const version = await createFileVersion({
    fileId,
    versionNumber: 1,
    uploadedBy: userId,
    s3Key,
    size: multerFile.size,
    mimeType,
    isEncrypted,
  });
  await setActiveVersion(fileId, version.id);

  return { file: stored };
}

export async function listFiles(userId: string): Promise<StoredFile[]> {
  return getFilesByUser(userId);
}

/**
 * Resolves the bytes to serve for a file: the active FileVersion's S3 object
 * if one exists, otherwise the legacy local-disk copy for files that predate
 * the S3 migration.
 */
async function resolveContent(
  file: StoredFile,
): Promise<{ stream: Readable; mimeType: string; size: number }> {
  const activeVersion = await getActiveVersion(file.id);
  if (activeVersion) {
    const stream = await s3Service.getObjectStream(activeVersion.s3Key);
    return { stream, mimeType: activeVersion.mimeType, size: activeVersion.size };
  }

  if (!file.diskPath || !fs.existsSync(file.diskPath)) {
    throw new Error("File no longer exists.");
  }
  return { stream: fs.createReadStream(file.diskPath), mimeType: file.mimeType, size: file.size };
}

export async function downloadFile(
  fileId: string,
  requestingUserId: string,
): Promise<{ stream: Readable; file: StoredFile }> {
  const { file } = await requireFileAccess(fileId, requestingUserId, "download");

  const { stream } = await resolveContent(file);

  return { stream, file };
}

/**
 * Stream a file directly to the HTTP response for inline preview.
 */
export async function streamFileDownload(
  fileId: string,
  requestingUserId: string,
): Promise<{
  stream: Readable;
  originalName: string;
  mimeType: string;
  size: number;
}> {
  const { file: stored } = await requireFileAccess(fileId, requestingUserId, "view");
  const { stream, mimeType, size } = await resolveContent(stored);

  return {
    stream,
    originalName: stored.originalName,
    mimeType,
    size,
  };
}

export async function streamFileDownloadForShareLink(
  fileId: string,
): Promise<{
  stream: Readable;
  originalName: string;
  mimeType: string;
  size: number;
}> {
  const stored = await getFileById(fileId);
  if (!stored) {
    throw new Error("File not found.");
  }

  const { stream, mimeType, size } = await resolveContent(stored);

  return {
    stream,
    originalName: stored.originalName,
    mimeType,
    size,
  };
}

/**
 * Delete a file: removes every version's S3 object (or the legacy disk
 * copy), all FileVersion/VersionRequest records, and the file's metadata.
 */
export async function deleteFile(
  fileId: string,
  requestingUserId: string,
): Promise<StoredFile> {
  const file = await getFileById(fileId);
  if (!file) throw new Error("File not found.");
  if (file.userId !== requestingUserId) throw new Error("Access denied.");

  const versions = await getVersionsByFile(fileId);
  await Promise.all(versions.map((v) => s3Service.deleteObject(v.s3Key).catch(() => {})));
  await deleteVersionsByFile(fileId);

  if (file.diskPath && fs.existsSync(file.diskPath)) {
    fs.unlinkSync(file.diskPath);
  }

  await deleteFileFromStore(fileId);

  return file;
}

export async function getFileDetails(
  fileId: string,
  requestingUserId: string,
): Promise<StoredFile> {
  // Owner or any user the file is shared with may view its details.
  const { file } = await requireFileAccess(fileId, requestingUserId, "view");

  return file;
}
