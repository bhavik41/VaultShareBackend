import { v4 as uuidv4 } from "uuid";
import { FileVersionModel, IFileVersion } from "../models/FileVersion";
import { FileModel } from "../models/File";

export interface StoredFileVersion {
  id: string;
  fileId: string;
  versionNumber: number;
  uploadedBy: string;
  s3Key: string;
  size: number;
  mimeType: string;
  changeNote?: string;
  isActive: boolean;
  isEncrypted: boolean;
  createdAt: Date;
}

function toStored(doc: IFileVersion): StoredFileVersion {
  return {
    id: doc._id,
    fileId: doc.fileId,
    versionNumber: doc.versionNumber,
    uploadedBy: doc.uploadedBy,
    s3Key: doc.s3Key,
    size: doc.size,
    mimeType: doc.mimeType,
    changeNote: doc.changeNote,
    isActive: doc.isActive,
    isEncrypted: doc.isEncrypted,
    createdAt: doc.createdAt,
  };
}

export async function getNextVersionNumber(fileId: string): Promise<number> {
  const latest = await FileVersionModel.findOne({ fileId })
    .sort({ versionNumber: -1 })
    .lean();
  return (latest?.versionNumber ?? 0) + 1;
}

export async function createFileVersion(input: {
  fileId: string;
  versionNumber: number;
  uploadedBy: string;
  s3Key: string;
  size: number;
  mimeType: string;
  changeNote?: string;
  isEncrypted: boolean;
}): Promise<StoredFileVersion> {
  const doc = await FileVersionModel.create({
    _id: uuidv4(),
    ...input,
    isActive: false,
  });
  return toStored(doc.toObject());
}

export async function getVersionsByFile(fileId: string): Promise<StoredFileVersion[]> {
  const docs = await FileVersionModel.find({ fileId }).sort({ versionNumber: -1 }).lean();
  return docs.map(toStored);
}

export async function getVersionById(versionId: string): Promise<StoredFileVersion | undefined> {
  const doc = await FileVersionModel.findById(versionId).lean();
  return doc ? toStored(doc) : undefined;
}

export async function getActiveVersion(fileId: string): Promise<StoredFileVersion | undefined> {
  const doc = await FileVersionModel.findOne({ fileId, isActive: true }).lean();
  return doc ? toStored(doc) : undefined;
}

/**
 * Atomically flips isActive off for the file's current active version and on
 * for the given version, then points File.activeVersionId at it.
 */
export async function setActiveVersion(
  fileId: string,
  versionId: string,
): Promise<StoredFileVersion> {
  const version = await FileVersionModel.findById(versionId).lean();
  if (!version || version.fileId !== fileId) {
    throw new Error("Version not found.");
  }

  await FileVersionModel.updateMany({ fileId, isActive: true }, { isActive: false });
  const updated = await FileVersionModel.findByIdAndUpdate(
    versionId,
    { isActive: true },
    { new: true },
  ).lean();
  await FileModel.findByIdAndUpdate(fileId, { activeVersionId: versionId });

  return toStored(updated!);
}

export async function deleteFileVersion(versionId: string): Promise<boolean> {
  const res = await FileVersionModel.deleteOne({ _id: versionId });
  return res.deletedCount > 0;
}

export async function deleteVersionsByFile(fileId: string): Promise<void> {
  await FileVersionModel.deleteMany({ fileId });
}
