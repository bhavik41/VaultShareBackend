import { StoredFile, getFileById } from "../db/fileStore";
import { CollaboratorRole, getFileShare } from "../db/collaborationStore";

export type FileAccessAction = "view" | "edit" | "download" | "owner";

export interface FilePermission {
  file: StoredFile;
  role: CollaboratorRole;
}

const roleRank: Record<CollaboratorRole, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

const actionRank: Record<FileAccessAction, number> = {
  view: 1,
  edit: 2,
  download: 2,
  owner: 3,
};

export async function getFilePermission(
  fileId: string,
  userId: string,
): Promise<FilePermission | null> {
  const file = await getFileById(fileId);
  if (!file) throw new Error("File not found.");

  if (file.userId === userId) {
    return { file, role: "owner" };
  }

  const share = await getFileShare(fileId, userId);
  if (!share) return null;

  return { file, role: share.role };
}

export async function requireFileAccess(
  fileId: string,
  userId: string,
  action: FileAccessAction = "view",
): Promise<FilePermission> {
  const permission = await getFilePermission(fileId, userId);

  if (!permission) {
    throw new Error("Access denied.");
  }

  if (roleRank[permission.role] < actionRank[action]) {
    throw new Error("Access denied.");
  }

  return permission;
}
