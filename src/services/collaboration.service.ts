import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { v4 as uuidv4 } from "../utils/uuid";
import { getFileById, getFilesByIds } from "../db/fileStore";
import { findUserByEmail, findUserById, findUsersByIds } from "../db/inMemoryStore";
import * as fileService from "./file.service";
import {
  CollaborationInvitation,
  FileShare,
  ShareLink,
  SharedRole,
  ShareLinkPermissionMode,
  createFileShare,
  createInvitation,
  createShareLink,
  findPendingInvitation,
  getFileShare,
  getInvitationById,
  getInvitationsByFile,
  getInvitationsForUser,
  getShareLinkByToken,
  getShareLinksByFile,
  getSharesByFile,
  getSharesByUser,
  removeFileShare,
  revokeShareLink,
  updateFileShareRole,
  updateInvitationStatus,
} from "../db/collaborationStore";
import * as auditService from "./audit.service";

interface InviteCollaboratorInput {
  fileId: string;
  inviterId: string;
  inviteeEmail: string;
  role: string;
}

interface ShareFileInput {
  fileId: string;
  ownerId: string;
  collaboratorEmail: string;
  role: string;
}

interface CreateShareLinkInput {
  fileId: string;
  ownerId: string;
  permissionMode: string;
  expiresAt?: string;
  password?: string;
}

interface SharedFileResult {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  role: SharedRole;
  createdAt: Date;
  sharedAt: Date;
}

export function validateSharedRole(role: string): SharedRole {
  if (role === "editor" || role === "viewer") return role;
  throw new Error("Role must be either editor or viewer.");
}

export function validateShareLinkPermissionMode(
  permissionMode: string,
): ShareLinkPermissionMode {
  if (
    permissionMode === "viewer" ||
    permissionMode === "editor" ||
    permissionMode === "download" ||
    permissionMode === "admin-download"
  ) {
    return permissionMode;
  }

  throw new Error(
    "Share link permission mode must be one of viewer, editor, download, or admin-download.",
  );
}

async function requireFileOwner(fileId: string, userId: string) {
  const file = await getFileById(fileId);
  if (!file) throw new Error("File not found.");
  if (file.userId !== userId) throw new Error("Access denied.");
  return file;
}

function generateShareToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export function parseExpirationDate(expiresAt?: string): Date {
  if (!expiresAt) {
    return new Date(Date.now() + 24 * 60 * 60 * 1000);
  }

  const expirationDate = new Date(expiresAt);

  if (Number.isNaN(expirationDate.getTime())) {
    throw new Error("expiresAt must be a valid date.");
  }

  if (expirationDate <= new Date()) {
    throw new Error("expiresAt must be in the future.");
  }

  return expirationDate;
}

export async function inviteCollaborator(
  input: InviteCollaboratorInput,
): Promise<CollaborationInvitation> {
  const { fileId, inviterId, inviteeEmail } = input;
  const role = validateSharedRole(input.role);

  const file = await requireFileOwner(fileId, inviterId);
  const invitee = await findUserByEmail(inviteeEmail);

  if (!invitee) {
    throw new Error("Invited user must have a registered account.");
  }

  if (invitee.id === inviterId) {
    throw new Error("You cannot invite yourself to your own file.");
  }

  const existingShare = await getFileShare(file.id, invitee.id);
  if (existingShare) {
    throw new Error("This user already has access to the file.");
  }

  const pendingInvitation = await findPendingInvitation(file.id, invitee.id);
  if (pendingInvitation) {
    throw new Error("A pending invitation already exists for this user.");
  }

  const invitation = await createInvitation({
    id: uuidv4(),
    fileId: file.id,
    inviterId,
    inviteeId: invitee.id,
    inviteeEmail: invitee.email,
    role,
    status: "pending",
    createdAt: new Date(),
  });

  auditService.logAction(file.id, inviterId, "share", `Invited ${inviteeEmail} as ${role}`);

  return invitation;
}

export async function listMyInvitations(userId: string, limit: number = 50, offset: number = 0) {
  const invitations = await getInvitationsForUser(userId, limit, offset);
  
  // #64, #67 - Bulk lookups to prevent N+1 queries
  const fileIds = [...new Set(invitations.map(i => i.fileId))];
  const inviterIds = [...new Set(invitations.map(i => i.inviterId))];
  
  const [files, inviters] = await Promise.all([
    getFilesByIds(fileIds),
    findUsersByIds(inviterIds)
  ]);
  
  const fileMap = new Map(files.map(f => [f.id, f]));
  const inviterMap = new Map(inviters.map(u => [u.id, u]));

  return invitations.map((invitation) => {
    const file = fileMap.get(invitation.fileId);
    const inviter = inviterMap.get(invitation.inviterId);

    return {
      ...invitation,
      fileName: file?.originalName ?? "Unknown file",
      inviterName: inviter?.name ?? "Unknown user",
      inviterEmail: inviter?.email ?? "",
    };
  });
}

export async function listFileInvitations(fileId: string, ownerId: string) {
  await requireFileOwner(fileId, ownerId);
  return getInvitationsByFile(fileId);
}

export async function respondToInvitation(
  invitationId: string,
  userId: string,
  status: string,
) {
  if (status !== "accepted" && status !== "rejected") {
    throw new Error("Status must be accepted or rejected.");
  }

  const invitation = await getInvitationById(invitationId);
  if (!invitation) throw new Error("Invitation not found.");

  if (invitation.inviteeId !== userId) {
    throw new Error("Access denied.");
  }

  if (invitation.status !== "pending") {
    throw new Error("Invitation has already been responded to.");
  }

  const updatedInvitation = await updateInvitationStatus(invitationId, status);
  if (!updatedInvitation) throw new Error("Invitation not found.");

  let share = null;

  if (status === "accepted") {
    const file = await getFileById(invitation.fileId);
    if (!file) throw new Error("File not found.");

    const existingShare = await getFileShare(invitation.fileId, userId);

    share =
      existingShare ??
      (await createFileShare({
        id: uuidv4(),
        fileId: invitation.fileId,
        ownerId: file.userId,
        userId,
        role: invitation.role,
        createdAt: new Date(),
        updatedAt: new Date(),
      }));
  }

  if (status === "accepted" && share) {
    auditService.logAction(invitation.fileId, userId, "share", `Accepted invitation with role ${invitation.role}`);
  }

  return {
    invitation: updatedInvitation,
    share,
  };
}

export async function shareFileWithUser(input: ShareFileInput): Promise<FileShare> {
  const { fileId, ownerId, collaboratorEmail } = input;
  const role = validateSharedRole(input.role);

  const file = await requireFileOwner(fileId, ownerId);
  const collaborator = await findUserByEmail(collaboratorEmail);

  if (!collaborator) {
    throw new Error("Collaborator must have a registered account.");
  }

  if (collaborator.id === ownerId) {
    throw new Error("You cannot share a file with yourself.");
  }

  const existingShare = await getFileShare(file.id, collaborator.id);
  if (existingShare) {
    throw new Error("This user already has access to the file.");
  }

  const share = await createFileShare({
    id: uuidv4(),
    fileId: file.id,
    ownerId,
    userId: collaborator.id,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  auditService.logAction(file.id, ownerId, "share", `Shared file with ${collaboratorEmail} as ${role}`);

  return share;
}

export async function listSharedUsers(fileId: string, ownerId: string, limit: number = 50, offset: number = 0) {
  const file = await requireFileOwner(fileId, ownerId);

  const shares = await getSharesByFile(file.id, limit, offset);
  
  // #65, #67 - Bulk lookups to prevent N+1 queries
  const userIds = [...new Set(shares.map(s => s.userId))];
  const users = await findUsersByIds(userIds);
  const userMap = new Map(users.map(u => [u.id, u]));

  return shares.map((share) => {
    const user = userMap.get(share.userId);

    return {
      id: share.id,
      fileId: share.fileId,
      userId: share.userId,
      name: user?.name ?? "Unknown user",
      email: user?.email ?? "",
      role: share.role,
      createdAt: share.createdAt,
      updatedAt: share.updatedAt,
    };
  });
}

export async function updateCollaboratorPermission(
  fileId: string,
  ownerId: string,
  collaboratorId: string,
  role: string,
): Promise<FileShare> {
  const validRole = validateSharedRole(role);
  await requireFileOwner(fileId, ownerId);

  const updatedShare = await updateFileShareRole(fileId, collaboratorId, validRole);
  if (!updatedShare) {
    throw new Error("Collaborator not found.");
  }

  auditService.logAction(fileId, ownerId, "permission_change", `Updated role for user ${collaboratorId} to ${validRole}`);

  return updatedShare;
}

export async function removeCollaborator(
  fileId: string,
  ownerId: string,
  collaboratorId: string,
): Promise<void> {
  await requireFileOwner(fileId, ownerId);

  const removed = await removeFileShare(fileId, collaboratorId);
  if (!removed) {
    throw new Error("Collaborator not found.");
  }

  auditService.logAction(fileId, ownerId, "revoke_access", `Removed collaborator ${collaboratorId}`);
}

export async function listFilesSharedWithMe(userId: string, limit: number = 50, offset: number = 0): Promise<SharedFileResult[]> {
  const shares = await getSharesByUser(userId, limit, offset);
  
  // #66, #67 - Bulk lookups to prevent N+1 queries
  const fileIds = [...new Set(shares.map(s => s.fileId))];
  const ownerIds = [...new Set(shares.map(s => s.ownerId))];
  
  const [files, owners] = await Promise.all([
    getFilesByIds(fileIds),
    findUsersByIds(ownerIds)
  ]);
  
  const fileMap = new Map(files.map(f => [f.id, f]));
  const ownerMap = new Map(owners.map(u => [u.id, u]));

  const resolved = shares.map((share) => {
    const file = fileMap.get(share.fileId);
    if (!file) return null;

    const owner = ownerMap.get(share.ownerId);

    return {
      id: file.id,
      name: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      ownerId: share.ownerId,
      ownerName: owner?.name ?? "Unknown user",
      ownerEmail: owner?.email ?? "",
      role: share.role,
      createdAt: file.createdAt,
      sharedAt: share.createdAt,
    };
  });
  
  return resolved.filter((file): file is SharedFileResult => file !== null);
}

export async function createFileShareLink(input: CreateShareLinkInput): Promise<ShareLink> {
  const { fileId, ownerId } = input;
  const permissionMode = validateShareLinkPermissionMode(input.permissionMode);
  const file = await requireFileOwner(fileId, ownerId);

  const passwordHash = input.password ? await bcrypt.hash(input.password, 12) : null;

  const link = await createShareLink({
    id: uuidv4(),
    fileId: file.id,
    ownerId,
    token: generateShareToken(),
    permissionMode,
    expiresAt: parseExpirationDate(input.expiresAt),
    revokedAt: null,
    createdAt: new Date(),
    passwordHash,
  });

  auditService.logAction(file.id, ownerId, "share", `Created share link with permission mode ${permissionMode}`);

  return link;
}

export async function verifyShareLinkPassword(token: string, password: string): Promise<string> {
  const shareLink = await getShareLinkByToken(token);
  if (!shareLink) throw new Error("Share link not found.");
  if (!shareLink.passwordHash) throw new Error("This share link is not password-protected.");

  const valid = await bcrypt.compare(password, shareLink.passwordHash);
  if (!valid) throw new Error("Incorrect password.");

  return jwt.sign(
    { shareToken: token, type: "share-unlock" },
    process.env.JWT_SECRET as string,
    { expiresIn: "30m" },
  );
}

export async function listFileShareLinks(fileId: string, ownerId: string): Promise<ShareLink[]> {
  const file = await requireFileOwner(fileId, ownerId);
  return getShareLinksByFile(file.id);
}

export async function revokeFileShareLink(token: string, ownerId: string): Promise<ShareLink> {
  const shareLink = await getShareLinkByToken(token);
  if (!shareLink) throw new Error("Share link not found.");

  if (shareLink.ownerId !== ownerId) {
    throw new Error("Access denied.");
  }

  const revokedShareLink = await revokeShareLink(token);
  if (!revokedShareLink) throw new Error("Share link not found.");

  auditService.logAction(shareLink.fileId, ownerId, "permission_change", `Revoked share link`);

  return revokedShareLink;
}

export async function validateShareLinkToken(token: string) {
  const shareLink = await getShareLinkByToken(token);
  if (!shareLink) throw new Error("Share link not found.");

  if (shareLink.revokedAt) {
    throw new Error("Share link has been revoked.");
  }

  if (shareLink.expiresAt <= new Date()) {
    throw new Error("Share link has expired.");
  }

  const file = await getFileById(shareLink.fileId);
  if (!file) throw new Error("File not found.");

  const owner = await findUserById(shareLink.ownerId);

  // Never expose passwordHash to clients; replace with a boolean flag
  const { passwordHash, ...shareLinkPublic } = shareLink;

  return {
    shareLink: { ...shareLinkPublic, passwordProtected: passwordHash !== null },
    file: {
      id: file.id,
      name: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      ownerId: file.userId,
      ownerName: owner?.name ?? "Unknown user",
      ownerEmail: owner?.email ?? "",
      permissionMode: shareLink.permissionMode,
      createdAt: file.createdAt,
      isEncrypted: file.isEncrypted,
    },
  };
}

// ── New methods added by feature/backend-audit-log ───────────────────────────

export async function getPendingInvitations(userId: string) {
  const invitations = await listMyInvitations(userId);
  return invitations.filter((inv) => inv.status === "pending");
}

export function acceptInvitation(userId: string, invitationId: string) {
  return respondToInvitation(invitationId, userId, "accepted");
}

export function rejectInvitation(userId: string, invitationId: string) {
  return respondToInvitation(invitationId, userId, "rejected");
}

export function changeRole(
  ownerId: string,
  fileId: string,
  userId: string,
  role: string,
): Promise<FileShare> {
  return updateCollaboratorPermission(fileId, ownerId, userId, role);
}

export function revokeAccess(
  ownerId: string,
  fileId: string,
  userId: string,
): Promise<void> {
  return removeCollaborator(fileId, ownerId, userId);
}
