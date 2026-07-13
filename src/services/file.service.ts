import crypto from "crypto";
import fs from "fs";
import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
import * as s3Service from "./s3.service";
import {
  createFile,
  getFileById,
  getFilesByUser,
  deleteFile as deleteFileFromStore,
  setAdminOnlyChat as setAdminOnlyChatInStore,
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

function hashBuffer(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

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
  const sha256 = hashBuffer(multerFile.buffer);

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
    originalName: multerFile.originalname,
    size: multerFile.size,
    mimeType,
    isEncrypted,
    sha256,
  });
  await setActiveVersion(fileId, version.id);

  return { file: stored };
}

export async function listFiles(userId: string): Promise<StoredFile[]> {
  return getFilesByUser(userId);
}

export type DownloadResult =
  | { kind: "signed"; url: string; sha256: string | undefined; file: StoredFile }
  | { kind: "stream"; stream: Readable; sha256: string | undefined; file: StoredFile };

export async function downloadFile(
  fileId: string,
  requestingUserId: string,
): Promise<DownloadResult> {
  const { file } = await requireFileAccess(fileId, requestingUserId, "download");

  const activeVersion = await getActiveVersion(file.id);
  if (activeVersion) {
    // S3-backed file: return a 15-minute presigned URL so the link itself expires
    // and cannot be shared to bypass RBAC.
    const url = await s3Service.getPresignedDownloadUrl(activeVersion.s3Key, 15 * 60);
    return { kind: "signed", url, sha256: activeVersion.sha256, file };
  }

  // Legacy disk-backed file: stream through the server.
  if (!file.diskPath || !fs.existsSync(file.diskPath)) {
    throw new Error("File no longer exists.");
  }
  return {
    kind: "stream",
    stream: fs.createReadStream(file.diskPath),
    sha256: undefined,
    file,
  };
}

/**
 * Stream a file directly to the HTTP response for inline preview.
 */
async function resolveContent(
  file: StoredFile,
): Promise<{ stream: Readable; mimeType: string; size: number; sha256?: string }> {
  const activeVersion = await getActiveVersion(file.id);
  if (activeVersion) {
    const stream = await s3Service.getObjectStream(activeVersion.s3Key);
    return { stream, mimeType: activeVersion.mimeType, size: activeVersion.size, sha256: activeVersion.sha256 };
  }

  if (!file.diskPath || !fs.existsSync(file.diskPath)) {
    throw new Error("File no longer exists.");
  }
  return { stream: fs.createReadStream(file.diskPath), mimeType: file.mimeType, size: file.size };
}

export async function streamFileDownload(
  fileId: string,
  requestingUserId: string,
): Promise<{
  stream: Readable;
  originalName: string;
  mimeType: string;
  size: number;
  sha256?: string;
}> {
  const { file: stored } = await requireFileAccess(fileId, requestingUserId, "view");
  const { stream, mimeType, size, sha256 } = await resolveContent(stored);

  return {
    stream,
    originalName: stored.originalName,
    mimeType,
    size,
    sha256,
  };
}

export async function streamFileDownloadForShareLink(
  fileId: string,
): Promise<{
  stream: Readable;
  originalName: string;
  mimeType: string;
  size: number;
  sha256?: string;
}> {
  const stored = await getFileById(fileId);
  if (!stored) {
    throw new Error("File not found.");
  }

  const { stream, mimeType, size, sha256 } = await resolveContent(stored);

  return {
    stream,
    originalName: stored.originalName,
    mimeType,
    size,
    sha256,
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
): Promise<{ file: StoredFile; role: string }> {
  const { file, role } = await requireFileAccess(fileId, requestingUserId, "view");
  return { file, role };
}

export async function setAdminOnlyChat(
  fileId: string,
  requestingUserId: string,
  adminOnlyChat: boolean,
): Promise<StoredFile> {
  const file = await getFileById(fileId);
  if (!file) throw new Error("File not found.");
  if (file.userId !== requestingUserId) throw new Error("Access denied.");
  const updated = await setAdminOnlyChatInStore(fileId, adminOnlyChat);
  if (!updated) throw new Error("File not found.");
  return updated;
}
