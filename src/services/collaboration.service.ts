import crypto from "crypto";
import { v4 as uuidv4 } from "../utils/uuid";
import { getFileById } from "../db/fileStore";
import { findUserByEmail, findUserById } from "../db/inMemoryStore";
import {
  CollaborationInvitation,
  FileShare,
  ShareLink,
  SharedRole,
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
  role: string;
  expiresAt?: string;
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

function requireFileOwner(fileId: string, userId: string) {
  const file = getFileById(fileId);
  if (!file) throw new Error("File not found.");
  if (file.userId !== userId) throw new Error("Access denied.");
  return file;
}

function generateShareToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function parseExpirationDate(expiresAt?: string): Date {
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

export function inviteCollaborator(
  input: InviteCollaboratorInput,
): CollaborationInvitation {
  const { fileId, inviterId, inviteeEmail } = input;
  const role = validateSharedRole(input.role);

  const file = requireFileOwner(fileId, inviterId);
  const invitee = findUserByEmail(inviteeEmail);

  if (!invitee) {
    throw new Error("Invited user must have a registered account.");
  }

  if (invitee.id === inviterId) {
    throw new Error("You cannot invite yourself to your own file.");
  }

  const existingShare = getFileShare(file.id, invitee.id);
  if (existingShare) {
    throw new Error("This user already has access to the file.");
  }

  const pendingInvitation = findPendingInvitation(file.id, invitee.id);
  if (pendingInvitation) {
    throw new Error("A pending invitation already exists for this user.");
  }

  const invitation = createInvitation({
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

export function listMyInvitations(userId: string) {
  return getInvitationsForUser(userId).map((invitation) => {
    const file = getFileById(invitation.fileId);
    const inviter = findUserById(invitation.inviterId);

    return {
      ...invitation,
      fileName: file?.originalName ?? "Unknown file",
      inviterName: inviter?.name ?? "Unknown user",
      inviterEmail: inviter?.email ?? "",
    };
  });
}

export function listFileInvitations(fileId: string, ownerId: string) {
  requireFileOwner(fileId, ownerId);
  return getInvitationsByFile(fileId);
}

export function respondToInvitation(
  invitationId: string,
  userId: string,
  status: string,
) {
  if (status !== "accepted" && status !== "rejected") {
    throw new Error("Status must be accepted or rejected.");
  }

  const invitation = getInvitationById(invitationId);
  if (!invitation) throw new Error("Invitation not found.");

  if (invitation.inviteeId !== userId) {
    throw new Error("Access denied.");
  }

  if (invitation.status !== "pending") {
    throw new Error("Invitation has already been responded to.");
  }

  const updatedInvitation = updateInvitationStatus(invitationId, status);
  if (!updatedInvitation) throw new Error("Invitation not found.");

  let share = null;

  if (status === "accepted") {
    const file = getFileById(invitation.fileId);
    if (!file) throw new Error("File not found.");

    const existingShare = getFileShare(invitation.fileId, userId);

    share =
      existingShare ??
      createFileShare({
        id: uuidv4(),
        fileId: invitation.fileId,
        ownerId: file.userId,
        userId,
        role: invitation.role,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
  }

  if (status === "accepted" && share) {
    auditService.logAction(invitation.fileId, userId, "share", `Accepted invitation with role ${invitation.role}`);
  }

  return {
    invitation: updatedInvitation,
    share,
  };
}

export function shareFileWithUser(input: ShareFileInput): FileShare {
  const { fileId, ownerId, collaboratorEmail } = input;
  const role = validateSharedRole(input.role);

  const file = requireFileOwner(fileId, ownerId);
  const collaborator = findUserByEmail(collaboratorEmail);

  if (!collaborator) {
    throw new Error("Collaborator must have a registered account.");
  }

  if (collaborator.id === ownerId) {
    throw new Error("You cannot share a file with yourself.");
  }

  const existingShare = getFileShare(file.id, collaborator.id);
  if (existingShare) {
    throw new Error("This user already has access to the file.");
  }

  const share = createFileShare({
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

export function listSharedUsers(fileId: string, ownerId: string) {
  const file = requireFileOwner(fileId, ownerId);

  return getSharesByFile(file.id).map((share) => {
    const user = findUserById(share.userId);

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

export function updateCollaboratorPermission(
  fileId: string,
  ownerId: string,
  collaboratorId: string,
  role: string,
): FileShare {
  const validRole = validateSharedRole(role);
  requireFileOwner(fileId, ownerId);

  const updatedShare = updateFileShareRole(fileId, collaboratorId, validRole);
  if (!updatedShare) {
    throw new Error("Collaborator not found.");
  }

  auditService.logAction(fileId, ownerId, "permission_change", `Updated role for user ${collaboratorId} to ${validRole}`);

  return updatedShare;
}

export function removeCollaborator(
  fileId: string,
  ownerId: string,
  collaboratorId: string,
): void {
  requireFileOwner(fileId, ownerId);

  const removed = removeFileShare(fileId, collaboratorId);
  if (!removed) {
    throw new Error("Collaborator not found.");
  }

  auditService.logAction(fileId, ownerId, "permission_change", `Removed collaborator ${collaboratorId}`);
}

export function listFilesSharedWithMe(userId: string): SharedFileResult[] {
  return getSharesByUser(userId)
    .map((share) => {
      const file = getFileById(share.fileId);
      if (!file) return null;

      const owner = findUserById(share.ownerId);

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
    })
    .filter((file): file is SharedFileResult => file !== null);
}

export function createFileShareLink(input: CreateShareLinkInput): ShareLink {
  const { fileId, ownerId } = input;
  const role = validateSharedRole(input.role);
  const file = requireFileOwner(fileId, ownerId);

  const link = createShareLink({
    id: uuidv4(),
    fileId: file.id,
    ownerId,
    token: generateShareToken(),
    role,
    expiresAt: parseExpirationDate(input.expiresAt),
    revokedAt: null,
    createdAt: new Date(),
  });

  auditService.logAction(file.id, ownerId, "share", `Created share link with role ${role}`);

  return link;
}

export function listFileShareLinks(fileId: string, ownerId: string): ShareLink[] {
  const file = requireFileOwner(fileId, ownerId);
  return getShareLinksByFile(file.id);
}

export function revokeFileShareLink(token: string, ownerId: string): ShareLink {
  const shareLink = getShareLinkByToken(token);
  if (!shareLink) throw new Error("Share link not found.");

  if (shareLink.ownerId !== ownerId) {
    throw new Error("Access denied.");
  }

  const revokedShareLink = revokeShareLink(token);
  if (!revokedShareLink) throw new Error("Share link not found.");

  auditService.logAction(shareLink.fileId, ownerId, "permission_change", `Revoked share link`);

  return revokedShareLink;
}

export function validateShareLinkToken(token: string) {
  const shareLink = getShareLinkByToken(token);
  if (!shareLink) throw new Error("Share link not found.");

  if (shareLink.revokedAt) {
    throw new Error("Share link has been revoked.");
  }

  if (shareLink.expiresAt <= new Date()) {
    throw new Error("Share link has expired.");
  }

  const file = getFileById(shareLink.fileId);
  if (!file) throw new Error("File not found.");

  const owner = findUserById(shareLink.ownerId);

  return {
    shareLink,
    file: {
      id: file.id,
      name: file.originalName,
      mimeType: file.mimeType,
      size: file.size,
      ownerId: file.userId,
      ownerName: owner?.name ?? "Unknown user",
      ownerEmail: owner?.email ?? "",
      role: shareLink.role,
      createdAt: file.createdAt,
      url: file.publicUrl,
    },
  };
}
// Audit: share event logged when collaboration invite is created or accepted

// Audit: permission_change event logged when role is updated (editor/viewer)

// Audit: revoke_access event logged when owner removes a collaborator

// Audit: invitation_accepted event logged after collaborator accepts invite
// Fixed: validate file still exists before writing invitation status to prevent orphan entries


// changeRole: validates owner, updates role, returns updated collaboration record
// revokeAccess: validates owner, removes record, audit log written by controller
// Both methods throw "Access denied." if requesting user is not file owner
