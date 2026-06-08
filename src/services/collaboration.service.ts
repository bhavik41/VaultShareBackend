import { v4 as uuidv4 } from "../utils/uuid";
import { getFileById } from "../db/fileStore";
import { findUserByEmail, findUserById } from "../db/inMemoryStore";
import {
  CollaborationInvitation,
  FileShare,
  SharedRole,
  createFileShare,
  createInvitation,
  findPendingInvitation,
  getFileShare,
  getInvitationById,
  getInvitationsByFile,
  getInvitationsForUser,
  getSharesByFile,
  getSharesByUser,
  removeFileShare,
  updateFileShareRole,
  updateInvitationStatus,
} from "../db/collaborationStore";

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

  return createInvitation({
    id: uuidv4(),
    fileId: file.id,
    inviterId,
    inviteeId: invitee.id,
    inviteeEmail: invitee.email,
    role,
    status: "pending",
    createdAt: new Date(),
  });
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

  return createFileShare({
    id: uuidv4(),
    fileId: file.id,
    ownerId,
    userId: collaborator.id,
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
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