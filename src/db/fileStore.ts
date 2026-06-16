/**
 * File metadata store backed by MongoDB.
 *
 * The uploaded bytes live on local disk (see middleware/upload.ts); this store
 * persists the metadata that maps a file id to its disk path, owner, etc.
 */
import { FileModel, IFile } from "../models/File";

export interface StoredFile {
  id: string;
  userId: string;
  originalName: string;
  mimeType: string;
  size: number;
  diskPath: string;
  publicUrl: string;
  adminOnlyChat: boolean;
  createdAt: Date;
}

function toStoredFile(doc: IFile): StoredFile {
  return {
    id: doc._id,
    userId: doc.userId,
    originalName: doc.originalName,
    mimeType: doc.mimeType,
    size: doc.size,
    diskPath: doc.diskPath,
    publicUrl: doc.publicUrl,
    adminOnlyChat: doc.adminOnlyChat ?? false,
    createdAt: doc.createdAt,
  };
}

export const createFile = async (file: StoredFile): Promise<StoredFile> => {
  const doc = await FileModel.create({
    _id: file.id,
    userId: file.userId,
    originalName: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    diskPath: file.diskPath,
    publicUrl: file.publicUrl,
    createdAt: file.createdAt,
  });
  return toStoredFile(doc.toObject());
};

export const getFileById = async (id: string): Promise<StoredFile | undefined> => {
  const doc = await FileModel.findById(id).lean();
  return doc ? toStoredFile(doc) : undefined;
};

export const getFilesByUser = async (userId: string): Promise<StoredFile[]> => {
  const docs = await FileModel.find({ userId }).sort({ createdAt: -1 }).lean();
  return docs.map(toStoredFile);
};

export const setAdminOnlyChat = async (
  id: string,
  adminOnlyChat: boolean,
): Promise<StoredFile | undefined> => {
  const doc = await FileModel.findByIdAndUpdate(
    id,
    { adminOnlyChat },
    { new: true },
  ).lean();
  return doc ? toStoredFile(doc) : undefined;
};

export const deleteFile = async (id: string): Promise<boolean> => {
  const res = await FileModel.deleteOne({ _id: id });
  return res.deletedCount > 0;
};

export const getAllFiles = async (): Promise<StoredFile[]> => {
  const docs = await FileModel.find().lean();
  return docs.map(toStoredFile);
};
