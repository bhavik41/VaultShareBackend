import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import * as auditService from "./audit.service";
import {
  createFile,
  getFileById,
  getFilesByUser,
  deleteFile as deleteFileFromStore,
  StoredFile,
} from "../db/fileStore";
import { getFilePermission } from "../utils/accessControl";

export interface UploadResult {
  file: StoredFile;
}

export async function uploadFile(
  userId: string,
  multerFile: Express.Multer.File,
): Promise<UploadResult> {
  const fileId = uuidv4();
  const stored = await createFile({
    id: fileId,
    userId,
    originalName: multerFile.originalname,
    mimeType: multerFile.mimetype,
    size: multerFile.size,
    diskPath: multerFile.path,
    publicUrl: `/api/files/${fileId}/download`,
    adminOnlyChat: false,
    createdAt: new Date(),
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
  // Owner or any user the file is shared with (viewer/editor) may download.
  const permission = await getFilePermission(fileId, requestingUserId);
  if (!permission) throw new Error("Access denied.");
  const { file } = permission;

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
  stream: NodeJS.ReadableStream;
  originalName: string;
  mimeType: string;
  size: number;
}> {
  const { file: stored } = requireFileAccess(fileId, requestingUserId, "view");

  const gcsFile = storage.bucket(stored.gcsBucket).file(stored.gcsKey);

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

export async function streamFileDownloadForShareLink(
  fileId: string,
): Promise<{
  stream: NodeJS.ReadableStream;
  originalName: string;
  mimeType: string;
  size: number;
}> {
  const stored = getFileById(fileId);
  if (!stored) {
    throw new Error("File not found.");
  }

  const gcsFile = storage.bucket(stored.gcsBucket).file(stored.gcsKey);
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
  const permission = await getFilePermission(fileId, requestingUserId);
  if (!permission) throw new Error("Access denied.");
  const { file } = permission;

  auditService.logAction(fileId, requestingUserId, "view", `Viewed ${file.originalName}`);

  return file;
}
