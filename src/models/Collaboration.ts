import { Schema, model } from 'mongoose'

export type SharedRole = 'editor' | 'viewer'
export type InvitationStatus = 'pending' | 'accepted' | 'rejected'
export type ShareLinkPermissionMode = 'viewer' | 'editor' | 'download' | 'admin-download'

export interface IInvitation {
  _id: string
  fileId: string
  inviterId: string
  inviteeId: string
  inviteeEmail: string
  role: SharedRole
  status: InvitationStatus
  createdAt: Date
  respondedAt?: Date
}

export interface IFileShare {
  _id: string
  fileId: string
  ownerId: string
  userId: string
  role: SharedRole
  createdAt: Date
  updatedAt: Date
}

export interface IShareLink {
  _id: string
  fileId: string
  ownerId: string
  token: string
  permissionMode: ShareLinkPermissionMode
  expiresAt: Date
  revokedAt: Date | null
  createdAt: Date
  passwordHash: string | null
}

const invitationSchema = new Schema<IInvitation>({
  _id: { type: String },
  fileId: { type: String, required: true, index: true },
  inviterId: { type: String, required: true },
  inviteeId: { type: String, required: true, index: true },
  inviteeEmail: { type: String, required: true },
  role: { type: String, enum: ['editor', 'viewer'], required: true },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: () => new Date() },
  respondedAt: { type: Date },
})

invitationSchema.index({ fileId: 1, inviteeId: 1 })

const fileShareSchema = new Schema<IFileShare>({
  _id: { type: String },
  fileId: { type: String, required: true },
  ownerId: { type: String, required: true },
  userId: { type: String, required: true },
  role: { type: String, enum: ['editor', 'viewer'], required: true },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
})

fileShareSchema.index({ fileId: 1, userId: 1 }, { unique: true })
fileShareSchema.index({ userId: 1 })

const shareLinkSchema = new Schema<IShareLink>({
  _id: { type: String },
  fileId: { type: String, required: true, index: true },
  ownerId: { type: String, required: true },
  token: { type: String, required: true, unique: true, index: true },
  permissionMode: {
    type: String,
    enum: ['viewer', 'editor', 'download', 'admin-download'],
    required: true,
  },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
  createdAt: { type: Date, default: () => new Date() },
  passwordHash: { type: String, default: null },
})

export const InvitationModel = model<IInvitation>('Invitation', invitationSchema)
export const FileShareModel = model<IFileShare>('FileShare', fileShareSchema)
export const ShareLinkModel = model<IShareLink>('ShareLink', shareLinkSchema)
