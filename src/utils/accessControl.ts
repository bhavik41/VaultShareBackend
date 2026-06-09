import { StoredFile, getFileById } from "../db/fileStore";
import { CollaboratorRole, getFileShare } from "../db/collaborationStore";

export type FileAccessAction = "view" | "edit" | "owner";

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
  owner: 3,
};

export function getFilePermission(
  fileId: string,
  userId: string,
): FilePermission | null {
  const file = getFileById(fileId);
  if (!file) throw new Error("File not found.");

  if (file.userId === userId) {
    return { file, role: "owner" };
  }

  const share = getFileShare(fileId, userId);
  if (!share) return null;

  return { file, role: share.role };
}

export function requireFileAccess(
  fileId: string,
  userId: string,
  action: FileAccessAction = "view",
): FilePermission {
  const permission = getFilePermission(fileId, userId);

  if (!permission) {
    throw new Error("Access denied.");
  }

  if (roleRank[permission.role] < actionRank[action]) {
    throw new Error("Access denied.");
  }

  return permission;
}