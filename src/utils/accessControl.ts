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

export type VersionUploadDecision = "direct" | "request" | "denied";

/**
 * Decides whether a user can upload a new file version directly, must submit
 * a request for admin approval, or has no version-upload access at all —
 * based on the file's versionPolicy and the user's role.
 * The owner can always upload directly regardless of policy.
 */
export function getVersionUploadDecision(
  policy: "admin_only" | "role_gated" | "open",
  role: CollaboratorRole,
): VersionUploadDecision {
  if (role === "owner") return "direct";

  if (policy === "admin_only") return "denied";

  if (policy === "role_gated") {
    return roleRank[role] >= roleRank.viewer ? "request" : "denied";
  }

  // open: anyone with at least viewer access can upload directly
  return roleRank[role] >= roleRank.viewer ? "direct" : "denied";
}
