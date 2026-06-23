/**
 * Collaboration store backed by MongoDB (invitations, file shares, share links).
 */
import {
  InvitationModel,
  FileShareModel,
  ShareLinkModel,
  IInvitation,
  IFileShare,
  IShareLink,
} from "../models/Collaboration";

export type InvitationStatus = "pending" | "accepted" | "rejected";
export type CollaboratorRole = "owner" | "editor" | "viewer";
export type SharedRole = Exclude<CollaboratorRole, "owner">;
export type ShareLinkPermissionMode =
  | "viewer"
  | "editor"
  | "download"
  | "admin-download";

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
  permissionMode: ShareLinkPermissionMode;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

// ── Mappers ──────────────────────────────────────────────────────────────────

function toInvitation(doc: IInvitation): CollaborationInvitation {
  return {
    id: doc._id,
    fileId: doc.fileId,
    inviterId: doc.inviterId,
    inviteeId: doc.inviteeId,
    inviteeEmail: doc.inviteeEmail,
    role: doc.role,
    status: doc.status,
    createdAt: doc.createdAt,
    respondedAt: doc.respondedAt,
  };
}

function toFileShare(doc: IFileShare): FileShare {
  return {
    id: doc._id,
    fileId: doc.fileId,
    ownerId: doc.ownerId,
    userId: doc.userId,
    role: doc.role,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function toShareLink(doc: IShareLink): ShareLink {
  return {
    id: doc._id,
    fileId: doc.fileId,
    ownerId: doc.ownerId,
    token: doc.token,
    permissionMode: doc.permissionMode,
    expiresAt: doc.expiresAt,
    revokedAt: doc.revokedAt,
    createdAt: doc.createdAt,
  };
}

// ── Invitations ────────────────────────────────────────────────────────────────

export const createInvitation = async (
  invitation: CollaborationInvitation,
): Promise<CollaborationInvitation> => {
  const doc = await InvitationModel.create({
    _id: invitation.id,
    fileId: invitation.fileId,
    inviterId: invitation.inviterId,
    inviteeId: invitation.inviteeId,
    inviteeEmail: invitation.inviteeEmail,
    role: invitation.role,
    status: invitation.status,
    createdAt: invitation.createdAt,
    respondedAt: invitation.respondedAt,
  });
  return toInvitation(doc.toObject());
};

export const getInvitationById = async (
  id: string,
): Promise<CollaborationInvitation | undefined> => {
  const doc = await InvitationModel.findById(id).lean();
  return doc ? toInvitation(doc) : undefined;
};

export const getInvitationsForUser = async (
  userId: string,
): Promise<CollaborationInvitation[]> => {
  const docs = await InvitationModel.find({ inviteeId: userId }).lean();
  return docs.map(toInvitation);
};

export const getInvitationsByFile = async (
  fileId: string,
): Promise<CollaborationInvitation[]> => {
  const docs = await InvitationModel.find({ fileId }).lean();
  return docs.map(toInvitation);
};

export const findPendingInvitation = async (
  fileId: string,
  inviteeId: string,
): Promise<CollaborationInvitation | undefined> => {
  const doc = await InvitationModel.findOne({ fileId, inviteeId, status: "pending" }).lean();
  return doc ? toInvitation(doc) : undefined;
};

export const updateInvitationStatus = async (
  id: string,
  status: InvitationStatus,
): Promise<CollaborationInvitation | undefined> => {
  const doc = await InvitationModel.findByIdAndUpdate(
    id,
    { status, respondedAt: new Date() },
    { new: true },
  ).lean();
  return doc ? toInvitation(doc) : undefined;
};

// ── File shares ────────────────────────────────────────────────────────────────

export const createFileShare = async (share: FileShare): Promise<FileShare> => {
  const doc = await FileShareModel.create({
    _id: share.id,
    fileId: share.fileId,
    ownerId: share.ownerId,
    userId: share.userId,
    role: share.role,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
  });
  return toFileShare(doc.toObject());
};

export const getFileShare = async (
  fileId: string,
  userId: string,
): Promise<FileShare | undefined> => {
  const doc = await FileShareModel.findOne({ fileId, userId }).lean();
  return doc ? toFileShare(doc) : undefined;
};

export const getSharesByFile = async (fileId: string): Promise<FileShare[]> => {
  const docs = await FileShareModel.find({ fileId }).lean();
  return docs.map(toFileShare);
};

export const getSharesByUser = async (userId: string): Promise<FileShare[]> => {
  const docs = await FileShareModel.find({ userId }).lean();
  return docs.map(toFileShare);
};

export const updateFileShareRole = async (
  fileId: string,
  userId: string,
  role: SharedRole,
): Promise<FileShare | undefined> => {
  const doc = await FileShareModel.findOneAndUpdate(
    { fileId, userId },
    { role, updatedAt: new Date() },
    { new: true },
  ).lean();
  return doc ? toFileShare(doc) : undefined;
};

export const removeFileShare = async (
  fileId: string,
  userId: string,
): Promise<boolean> => {
  const res = await FileShareModel.deleteOne({ fileId, userId });
  return res.deletedCount > 0;
};

// ── Share links ────────────────────────────────────────────────────────────────

export const createShareLink = async (shareLink: ShareLink): Promise<ShareLink> => {
  const doc = await ShareLinkModel.create({
    _id: shareLink.id,
    fileId: shareLink.fileId,
    ownerId: shareLink.ownerId,
    token: shareLink.token,
    permissionMode: shareLink.permissionMode,
    expiresAt: shareLink.expiresAt,
    revokedAt: shareLink.revokedAt,
    createdAt: shareLink.createdAt,
  });
  return toShareLink(doc.toObject());
};

export const getShareLinkByToken = async (
  token: string,
): Promise<ShareLink | undefined> => {
  const doc = await ShareLinkModel.findOne({ token }).lean();
  return doc ? toShareLink(doc) : undefined;
};

export const getShareLinksByFile = async (fileId: string): Promise<ShareLink[]> => {
  const docs = await ShareLinkModel.find({ fileId }).lean();
  return docs.map(toShareLink);
};

export const revokeShareLink = async (
  token: string,
): Promise<ShareLink | undefined> => {
  const doc = await ShareLinkModel.findOneAndUpdate(
    { token },
    { revokedAt: new Date() },
    { new: true },
  ).lean();
  return doc ? toShareLink(doc) : undefined;
};
