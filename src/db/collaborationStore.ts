export type InvitationStatus = "pending" | "accepted" | "rejected";
export type CollaboratorRole = "owner" | "editor" | "viewer";
export type SharedRole = Exclude<CollaboratorRole, "owner">;

export interface CollaborationInvitation {
  id: string;
  fileId: string;
  inviterId: string;
  inviteeId: string;
  inviteeEmail: string;
  role: SharedRole;
  status: InvitationStatus;
  createdAt: Date;
  respondedAt?: Date;
}

export interface FileShare {
  id: string;
  fileId: string;
  ownerId: string;
  userId: string;
  role: SharedRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface ShareLink {
  id: string;
  fileId: string;
  ownerId: string;
  token: string;
  role: SharedRole;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

const invitations = new Map<string, CollaborationInvitation>();
const fileShares = new Map<string, FileShare>();
const shareLinks = new Map<string, ShareLink>();

export const createInvitation = (
  invitation: CollaborationInvitation,
): CollaborationInvitation => {
  invitations.set(invitation.id, invitation);
  return invitation;
};

export const getInvitationById = (
  id: string,
): CollaborationInvitation | undefined => {
  return invitations.get(id);
};

export const getInvitationsForUser = (
  userId: string,
): CollaborationInvitation[] => {
  return Array.from(invitations.values()).filter(
    (invitation) => invitation.inviteeId === userId,
  );
};

export const getInvitationsByFile = (
  fileId: string,
): CollaborationInvitation[] => {
  return Array.from(invitations.values()).filter(
    (invitation) => invitation.fileId === fileId,
  );
};

export const findPendingInvitation = (
  fileId: string,
  inviteeId: string,
): CollaborationInvitation | undefined => {
  return Array.from(invitations.values()).find(
    (invitation) =>
      invitation.fileId === fileId &&
      invitation.inviteeId === inviteeId &&
      invitation.status === "pending",
  );
};

export const updateInvitationStatus = (
  id: string,
  status: InvitationStatus,
): CollaborationInvitation | undefined => {
  const invitation = invitations.get(id);
  if (!invitation) return undefined;

  const updatedInvitation: CollaborationInvitation = {
    ...invitation,
    status,
    respondedAt: new Date(),
  };

  invitations.set(id, updatedInvitation);
  return updatedInvitation;
};

export const createFileShare = (share: FileShare): FileShare => {
  fileShares.set(share.id, share);
  return share;
};

export const getFileShare = (
  fileId: string,
  userId: string,
): FileShare | undefined => {
  return Array.from(fileShares.values()).find(
    (share) => share.fileId === fileId && share.userId === userId,
  );
};

export const getSharesByFile = (fileId: string): FileShare[] => {
  return Array.from(fileShares.values()).filter(
    (share) => share.fileId === fileId,
  );
};

export const getSharesByUser = (userId: string): FileShare[] => {
  return Array.from(fileShares.values()).filter(
    (share) => share.userId === userId,
  );
};

export const updateFileShareRole = (
  fileId: string,
  userId: string,
  role: SharedRole,
): FileShare | undefined => {
  const share = getFileShare(fileId, userId);
  if (!share) return undefined;

  const updatedShare: FileShare = {
    ...share,
    role,
    updatedAt: new Date(),
  };

  fileShares.set(share.id, updatedShare);
  return updatedShare;
};

export const removeFileShare = (fileId: string, userId: string): boolean => {
  const share = getFileShare(fileId, userId);
  if (!share) return false;

  fileShares.delete(share.id);
  return true;
};

export const createShareLink = (shareLink: ShareLink): ShareLink => {
  shareLinks.set(shareLink.id, shareLink);
  return shareLink;
};

export const getShareLinkByToken = (token: string): ShareLink | undefined => {
  return Array.from(shareLinks.values()).find(
    (shareLink) => shareLink.token === token,
  );
};

export const getShareLinksByFile = (fileId: string): ShareLink[] => {
  return Array.from(shareLinks.values()).filter(
    (shareLink) => shareLink.fileId === fileId,
  );
};

export const revokeShareLink = (token: string): ShareLink | undefined => {
  const shareLink = getShareLinkByToken(token);
  if (!shareLink) return undefined;

  const revokedShareLink: ShareLink = {
    ...shareLink,
    revokedAt: new Date(),
  };

  shareLinks.set(shareLink.id, revokedShareLink);
  return revokedShareLink;
};