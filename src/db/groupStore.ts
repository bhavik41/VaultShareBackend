import {
  GroupModel,
  GroupMemberModel,
  GroupFileShareModel,
  IGroup,
  IGroupMember,
  IGroupFileShare,
  GroupRole,
  SharedRole,
} from '../models/Group'

export { GroupRole, SharedRole }

export interface Group {
  id: string
  name: string
  description?: string
  ownerId: string
  createdAt: Date
  updatedAt: Date
}

export interface GroupMember {
  id: string
  groupId: string
  userId: string
  role: GroupRole
  joinedAt: Date
}

export interface GroupFileShare {
  id: string
  groupId: string
  fileId: string
  ownerId: string
  role: SharedRole
  createdAt: Date
  updatedAt: Date
}

// ── Mappers ──────────────────────────────────────────────────────────────────

function toGroup(doc: IGroup): Group {
  return {
    id: doc._id,
    name: doc.name,
    description: doc.description,
    ownerId: doc.ownerId,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

function toGroupMember(doc: IGroupMember): GroupMember {
  return {
    id: doc._id,
    groupId: doc.groupId,
    userId: doc.userId,
    role: doc.role,
    joinedAt: doc.joinedAt,
  }
}

function toGroupFileShare(doc: IGroupFileShare): GroupFileShare {
  return {
    id: doc._id,
    groupId: doc.groupId,
    fileId: doc.fileId,
    ownerId: doc.ownerId,
    role: doc.role,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  }
}

// ── Groups ────────────────────────────────────────────────────────────────────

export const createGroup = async (group: Group): Promise<Group> => {
  const doc = await GroupModel.create({
    _id: group.id,
    name: group.name,
    description: group.description,
    ownerId: group.ownerId,
    createdAt: group.createdAt,
    updatedAt: group.updatedAt,
  })
  return toGroup(doc.toObject())
}

export const getGroupById = async (id: string): Promise<Group | undefined> => {
  const doc = await GroupModel.findById(id).lean()
  return doc ? toGroup(doc) : undefined
}

export const getGroupsByOwner = async (ownerId: string): Promise<Group[]> => {
  const docs = await GroupModel.find({ ownerId }).lean()
  return docs.map(toGroup)
}

export const updateGroup = async (
  id: string,
  updates: Partial<Pick<Group, 'name' | 'description'>>,
): Promise<Group | undefined> => {
  const doc = await GroupModel.findByIdAndUpdate(
    id,
    { ...updates, updatedAt: new Date() },
    { new: true },
  ).lean()
  return doc ? toGroup(doc) : undefined
}

export const deleteGroup = async (id: string): Promise<boolean> => {
  const res = await GroupModel.deleteOne({ _id: id })
  return res.deletedCount > 0
}

// ── Group Members ─────────────────────────────────────────────────────────────

export const addGroupMember = async (member: GroupMember): Promise<GroupMember> => {
  const doc = await GroupMemberModel.create({
    _id: member.id,
    groupId: member.groupId,
    userId: member.userId,
    role: member.role,
    joinedAt: member.joinedAt,
  })
  return toGroupMember(doc.toObject())
}

export const getGroupMember = async (
  groupId: string,
  userId: string,
): Promise<GroupMember | undefined> => {
  const doc = await GroupMemberModel.findOne({ groupId, userId }).lean()
  return doc ? toGroupMember(doc) : undefined
}

export const getGroupMembers = async (groupId: string): Promise<GroupMember[]> => {
  const docs = await GroupMemberModel.find({ groupId }).lean()
  return docs.map(toGroupMember)
}

export const getGroupsForUser = async (userId: string): Promise<GroupMember[]> => {
  const docs = await GroupMemberModel.find({ userId }).lean()
  return docs.map(toGroupMember)
}

export const updateGroupMemberRole = async (
  groupId: string,
  userId: string,
  role: GroupRole,
): Promise<GroupMember | undefined> => {
  const doc = await GroupMemberModel.findOneAndUpdate(
    { groupId, userId },
    { role },
    { new: true },
  ).lean()
  return doc ? toGroupMember(doc) : undefined
}

export const removeGroupMember = async (
  groupId: string,
  userId: string,
): Promise<boolean> => {
  const res = await GroupMemberModel.deleteOne({ groupId, userId })
  return res.deletedCount > 0
}

export const removeAllGroupMembers = async (groupId: string): Promise<void> => {
  await GroupMemberModel.deleteMany({ groupId })
}

// ── Group File Shares ─────────────────────────────────────────────────────────

export const createGroupFileShare = async (share: GroupFileShare): Promise<GroupFileShare> => {
  const doc = await GroupFileShareModel.create({
    _id: share.id,
    groupId: share.groupId,
    fileId: share.fileId,
    ownerId: share.ownerId,
    role: share.role,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
  })
  return toGroupFileShare(doc.toObject())
}

export const getGroupFileShare = async (
  groupId: string,
  fileId: string,
): Promise<GroupFileShare | undefined> => {
  const doc = await GroupFileShareModel.findOne({ groupId, fileId }).lean()
  return doc ? toGroupFileShare(doc) : undefined
}

export const getGroupFileShares = async (groupId: string): Promise<GroupFileShare[]> => {
  const docs = await GroupFileShareModel.find({ groupId }).lean()
  return docs.map(toGroupFileShare)
}

export const getFileGroupShares = async (fileId: string): Promise<GroupFileShare[]> => {
  const docs = await GroupFileShareModel.find({ fileId }).lean()
  return docs.map(toGroupFileShare)
}

export const updateGroupFileShareRole = async (
  groupId: string,
  fileId: string,
  role: SharedRole,
): Promise<GroupFileShare | undefined> => {
  const doc = await GroupFileShareModel.findOneAndUpdate(
    { groupId, fileId },
    { role, updatedAt: new Date() },
    { new: true },
  ).lean()
  return doc ? toGroupFileShare(doc) : undefined
}

export const removeGroupFileShare = async (
  groupId: string,
  fileId: string,
): Promise<boolean> => {
  const res = await GroupFileShareModel.deleteOne({ groupId, fileId })
  return res.deletedCount > 0
}

export const removeAllGroupFileShares = async (groupId: string): Promise<void> => {
  await GroupFileShareModel.deleteMany({ groupId })
}
