/**
 * In-memory file metadata store.
 * Each record tracks what was uploaded, by whom, and where it lives in GCS.
 */

export interface StoredFile {
  id: string;
  userId: string;
  originalName: string;
  mimeType: string;
  size: number; // bytes
  gcsBucket: string;
  gcsKey: string; // path inside the bucket
  publicUrl: string; // signed or public URL
  createdAt: Date;
}

const files: Map<string, StoredFile> = new Map();

export const createFile = (file: StoredFile): StoredFile => {
  files.set(file.id, file);
  return file;
};

export const getFileById = (id: string): StoredFile | undefined =>
  files.get(id);

export const getFilesByUser = (userId: string): StoredFile[] =>
  Array.from(files.values()).filter((f) => f.userId === userId);

export const deleteFile = (id: string): boolean => {
  if (!files.has(id)) return false;
  files.delete(id);
  return true;
};

export const getAllFiles = (): StoredFile[] => Array.from(files.values());
