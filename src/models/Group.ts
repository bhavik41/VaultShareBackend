import { Schema, model } from 'mongoose'

export type GroupRole = 'viewer' | 'editor' | 'admin'
export type SharedRole = 'viewer' | 'editor'

export interface IGroup {
  _id: string
  name: string
  description?: string
  ownerId: string
  defaultRole: SharedRole
  createdAt: Date
  updatedAt: Date
}

export interface IGroupMember {
  _id: string
  groupId: string
  userId: string
  role: GroupRole
  joinedAt: Date
}

export interface IGroupFileShare {
  _id: string
  groupId: string
  fileId: string
  ownerId: string
  role: SharedRole
  createdAt: Date
  updatedAt: Date
}

const groupSchema = new Schema<IGroup>({
  _id: { type: String },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  ownerId: { type: String, required: true, index: true },
  defaultRole: { type: String, enum: ['viewer', 'editor'], default: 'viewer' },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
})

const groupMemberSchema = new Schema<IGroupMember>({
  _id: { type: String },
  groupId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  role: { type: String, enum: ['viewer', 'editor', 'admin'], required: true },
  joinedAt: { type: Date, default: () => new Date() },
})

groupMemberSchema.index({ groupId: 1, userId: 1 }, { unique: true })

const groupFileShareSchema = new Schema<IGroupFileShare>({
  _id: { type: String },
  groupId: { type: String, required: true, index: true },
  fileId: { type: String, required: true, index: true },
  ownerId: { type: String, required: true },
  role: { type: String, enum: ['viewer', 'editor'], required: true },
  createdAt: { type: Date, default: () => new Date() },
  updatedAt: { type: Date, default: () => new Date() },
})

groupFileShareSchema.index({ groupId: 1, fileId: 1 }, { unique: true })

export type InviteStatus = 'pending' | 'accepted' | 'rejected'

export interface IGroupInvitation {
  _id: string
  groupId: string
  inviterId: string
  inviteeId: string
  inviteeEmail: string
  role: GroupRole
  status: InviteStatus
  createdAt: Date
  respondedAt?: Date
}

const groupInvitationSchema = new Schema<IGroupInvitation>({
  _id: { type: String },
  groupId: { type: String, required: true, index: true },
  inviterId: { type: String, required: true },
  inviteeId: { type: String, required: true, index: true },
  inviteeEmail: { type: String, required: true },
  role: { type: String, enum: ['viewer', 'editor', 'admin'], required: true },
  status: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' },
  createdAt: { type: Date, default: () => new Date() },
  respondedAt: { type: Date },
})

groupInvitationSchema.index({ groupId: 1, inviteeId: 1 })

export const GroupModel = model<IGroup>('Group', groupSchema)
export const GroupMemberModel = model<IGroupMember>('GroupMember', groupMemberSchema)
export const GroupFileShareModel = model<IGroupFileShare>('GroupFileShare', groupFileShareSchema)
export const GroupInvitationModel = model<IGroupInvitation>('GroupInvitation', groupInvitationSchema)
