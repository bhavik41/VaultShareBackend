import { v4 as uuidv4 } from '../utils/uuid'
import { getFileById } from '../db/fileStore'
import { findUserByEmail, findUserById } from '../db/inMemoryStore'
import {
  Group,
  GroupMember,
  GroupFileShare,
  GroupRole,
  SharedRole,
  addGroupMember,
  createGroup,
  createGroupFileShare,
  deleteGroup,
  getFileGroupShares,
  getGroupById,
  getGroupFileShare,
  getGroupFileShares,
  getGroupMember,
  getGroupMembers,
  getGroupsByOwner,
  getGroupsForUser,
  removeAllGroupFileShares,
  removeAllGroupMembers,
  removeGroupFileShare,
  removeGroupMember,
  updateGroup,
  updateGroupFileShareRole,
  updateGroupMemberRole,
} from '../db/groupStore'
import { sendFileSharedEmail, sendGroupAccessEmail } from '../utils/email'

export function validateGroupRole(role: string): GroupRole {
  if (role === 'viewer' || role === 'editor' || role === 'admin') return role
  throw new Error('Role must be viewer, editor, or admin.')
}

export function validateSharedRole(role: string): SharedRole {
  if (role === 'viewer' || role === 'editor') return role
  throw new Error('Role must be viewer or editor.')
}

async function requireGroupAccess(
  groupId: string,
  userId: string,
  minRole: GroupRole = 'viewer',
): Promise<{ group: Group; member: GroupMember | null; isOwner: boolean }> {
  const group = await getGroupById(groupId)
  if (!group) throw new Error('Group not found.')

  if (group.ownerId === userId) {
    return { group, member: null, isOwner: true }
  }

  const member = await getGroupMember(groupId, userId)
  if (!member) throw new Error('Access denied.')

  const roleRank: Record<GroupRole, number> = { viewer: 1, editor: 2, admin: 3 }
  if (roleRank[member.role] < roleRank[minRole]) throw new Error('Access denied.')

  return { group, member, isOwner: false }
}

async function requireGroupOwnerOrAdmin(groupId: string, userId: string) {
  const { group, member, isOwner } = await requireGroupAccess(groupId, userId)
  if (!isOwner && member?.role !== 'admin') throw new Error('Access denied.')
  return group
}

// ── Group CRUD ─────────────────────────────────────────────────────────────────

export async function createNewGroup(
  ownerId: string,
  name: string,
  description?: string,
  defaultRole: SharedRole = 'viewer',
): Promise<Group> {
  if (!name || !name.trim()) throw new Error('Group name is required.')

  const group = await createGroup({
    id: uuidv4(),
    name: name.trim(),
    description: description?.trim(),
    ownerId,
    defaultRole,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  return group
}

export async function listMyGroups(userId: string): Promise<(Group & { role: string; memberCount: number })[]> {
  const [ownedGroups, memberships] = await Promise.all([
    getGroupsByOwner(userId),
    getGroupsForUser(userId),
  ])

  const memberGroupIds = new Set(memberships.map((m) => m.groupId))
  const uniqueOwnedGroups = ownedGroups.filter((g) => !memberGroupIds.has(g.id))

  const allGroupEntries: Array<{ group: Group; role: string }> = [
    ...uniqueOwnedGroups.map((g) => ({ group: g, role: 'owner' })),
    ...await Promise.all(
      memberships.map(async (m) => {
        const group = await getGroupById(m.groupId)
        return group ? { group, role: m.role } : null
      }),
    ).then((results) => results.filter((r): r is { group: Group; role: GroupRole } => r !== null)),
  ]

  return Promise.all(
    allGroupEntries.map(async ({ group, role }) => {
      const members = await getGroupMembers(group.id)
      return { ...group, role, memberCount: members.length + 1 }
    }),
  )
}

export async function getGroupDetails(groupId: string, requesterId: string) {
  const { group } = await requireGroupAccess(groupId, requesterId)

  const [members, fileShares] = await Promise.all([
    getGroupMembers(groupId),
    getGroupFileShares(groupId),
  ])

  const resolvedMembers = await Promise.all(
    members.map(async (m) => {
      const user = await findUserById(m.userId)
      return {
        id: m.id,
        userId: m.userId,
        name: user?.name ?? 'Unknown',
        email: user?.email ?? '',
        role: m.role,
        joinedAt: m.joinedAt,
      }
    }),
  )

  const owner = await findUserById(group.ownerId)
  const resolvedFiles = await Promise.all(
    fileShares.map(async (fs) => {
      const file = await getFileById(fs.fileId)
      return file
        ? {
            id: fs.id,
            fileId: fs.fileId,
            fileName: file.originalName,
            mimeType: file.mimeType,
            size: file.size,
            role: fs.role,
            sharedAt: fs.createdAt,
          }
        : null
    }),
  ).then((r) => r.filter(Boolean))

  return {
    ...group,
    ownerName: owner?.name ?? 'Unknown',
    ownerEmail: owner?.email ?? '',
    members: resolvedMembers,
    files: resolvedFiles,
    memberCount: resolvedMembers.length + 1,
  }
}

export async function updateGroupDetails(
  groupId: string,
  requesterId: string,
  updates: { name?: string; description?: string; defaultRole?: string },
): Promise<Group> {
  await requireGroupOwnerOrAdmin(groupId, requesterId)

  if (updates.name !== undefined && !updates.name.trim()) {
    throw new Error('Group name cannot be empty.')
  }

  const defaultRole = updates.defaultRole !== undefined
    ? validateSharedRole(updates.defaultRole)
    : undefined

  const updated = await updateGroup(groupId, {
    name: updates.name?.trim(),
    description: updates.description?.trim(),
    defaultRole,
  })
  if (!updated) throw new Error('Group not found.')
  return updated
}

export async function deleteGroupById(groupId: string, requesterId: string): Promise<void> {
  const group = await getGroupById(groupId)
  if (!group) throw new Error('Group not found.')
  if (group.ownerId !== requesterId) throw new Error('Access denied.')

  await Promise.all([
    removeAllGroupMembers(groupId),
    removeAllGroupFileShares(groupId),
  ])
  await deleteGroup(groupId)
}

// ── Members ────────────────────────────────────────────────────────────────────

export async function addMemberToGroup(
  groupId: string,
  requesterId: string,
  memberEmail: string,
  role: string,
): Promise<GroupMember> {
  const validRole = validateGroupRole(role)
  await requireGroupOwnerOrAdmin(groupId, requesterId)

  const user = await findUserByEmail(memberEmail)
  if (!user) throw new Error('User with that email does not have an account.')

  if (user.id === requesterId) throw new Error('You cannot add yourself as a member.')

  const group = await getGroupById(groupId)
  if (!group) throw new Error('Group not found.')
  if (group.ownerId === user.id) throw new Error('The group owner cannot be added as a member.')

  const existing = await getGroupMember(groupId, user.id)
  if (existing) throw new Error('User is already a member of this group.')

  const member = await addGroupMember({
    id: uuidv4(),
    groupId,
    userId: user.id,
    role: validRole,
    joinedAt: new Date(),
  })

  return member
}

export async function updateMemberRole(
  groupId: string,
  requesterId: string,
  targetUserId: string,
  role: string,
): Promise<GroupMember> {
  const validRole = validateGroupRole(role)
  await requireGroupOwnerOrAdmin(groupId, requesterId)

  const group = await getGroupById(groupId)
  if (!group) throw new Error('Group not found.')
  if (group.ownerId === targetUserId) throw new Error('Cannot change the owner\'s role.')

  const updated = await updateGroupMemberRole(groupId, targetUserId, validRole)
  if (!updated) throw new Error('Member not found.')
  return updated
}

export async function removeMemberFromGroup(
  groupId: string,
  requesterId: string,
  targetUserId: string,
): Promise<void> {
  const group = await getGroupById(groupId)
  if (!group) throw new Error('Group not found.')

  const isOwner = group.ownerId === requesterId
  const isAdmin = (await getGroupMember(groupId, requesterId))?.role === 'admin'
  const isSelf = requesterId === targetUserId

  if (!isOwner && !isAdmin && !isSelf) throw new Error('Access denied.')
  if (group.ownerId === targetUserId) throw new Error('Cannot remove the group owner.')

  const removed = await removeGroupMember(groupId, targetUserId)
  if (!removed) throw new Error('Member not found.')
}

export async function listGroupMembers(groupId: string, requesterId: string) {
  await requireGroupAccess(groupId, requesterId)
  const members = await getGroupMembers(groupId)
  return Promise.all(
    members.map(async (m) => {
      const user = await findUserById(m.userId)
      return {
        id: m.id,
        userId: m.userId,
        name: user?.name ?? 'Unknown',
        email: user?.email ?? '',
        role: m.role,
        joinedAt: m.joinedAt,
      }
    }),
  )
}

// ── File Sharing ──────────────────────────────────────────────────────────────

export async function shareFileWithGroup(
  groupId: string,
  fileId: string,
  requesterId: string,
  role: string,
): Promise<GroupFileShare> {
  const validRole = validateSharedRole(role)

  const file = await getFileById(fileId)
  if (!file) throw new Error('File not found.')
  if (file.userId !== requesterId) throw new Error('Access denied.')

  const group = await getGroupById(groupId)
  if (!group) throw new Error('Group not found.')

  const existing = await getGroupFileShare(groupId, fileId)
  if (existing) throw new Error('File is already shared with this group.')

  const share = await createGroupFileShare({
    id: uuidv4(),
    groupId,
    fileId,
    ownerId: requesterId,
    role: validRole,
    createdAt: new Date(),
    updatedAt: new Date(),
  })

  // Send notification emails to all group members
  const members = await getGroupMembers(groupId)
  const sharer = await findUserById(requesterId)
  const sharerName = sharer?.name ?? 'Someone'

  const emailPromises = members.map(async (m) => {
    const user = await findUserById(m.userId)
    if (user?.email) {
      await sendGroupAccessEmail(
        user.email,
        group.name,
        file.originalName,
        sharerName,
        validRole,
      ).catch(() => {})
    }
  })

  // Also notify the group owner if they aren't the sharer
  if (group.ownerId !== requesterId) {
    const owner = await findUserById(group.ownerId)
    if (owner?.email) {
      emailPromises.push(
        sendGroupAccessEmail(
          owner.email,
          group.name,
          file.originalName,
          sharerName,
          validRole,
        ).catch(() => {}),
      )
    }
  }

  await Promise.all(emailPromises)

  return share
}

export async function listGroupFiles(groupId: string, requesterId: string) {
  await requireGroupAccess(groupId, requesterId)

  const shares = await getGroupFileShares(groupId)
  const resolved = await Promise.all(
    shares.map(async (fs) => {
      const file = await getFileById(fs.fileId)
      return file
        ? {
            id: fs.id,
            fileId: fs.fileId,
            groupId: fs.groupId,
            fileName: file.originalName,
            mimeType: file.mimeType,
            size: file.size,
            role: fs.role,
            sharedAt: fs.createdAt,
          }
        : null
    }),
  )
  return resolved.filter(Boolean)
}

export async function updateGroupFilePermission(
  groupId: string,
  fileId: string,
  requesterId: string,
  role: string,
): Promise<GroupFileShare> {
  const validRole = validateSharedRole(role)

  const file = await getFileById(fileId)
  if (!file) throw new Error('File not found.')
  if (file.userId !== requesterId) throw new Error('Access denied.')

  const updated = await updateGroupFileShareRole(groupId, fileId, validRole)
  if (!updated) throw new Error('Group file share not found.')
  return updated
}

export async function removeFileFromGroup(
  groupId: string,
  fileId: string,
  requesterId: string,
): Promise<void> {
  const file = await getFileById(fileId)
  if (!file) throw new Error('File not found.')

  const group = await getGroupById(groupId)
  if (!group) throw new Error('Group not found.')

  const isFileOwner = file.userId === requesterId
  const isGroupOwner = group.ownerId === requesterId
  const isAdmin = (await getGroupMember(groupId, requesterId))?.role === 'admin'

  if (!isFileOwner && !isGroupOwner && !isAdmin) throw new Error('Access denied.')

  const removed = await removeGroupFileShare(groupId, fileId)
  if (!removed) throw new Error('Group file share not found.')
}

export async function getFilesSharedWithUserViaGroups(userId: string) {
  const memberships = await getGroupsForUser(userId)

  const seen = new Set<string>()
  const results: Array<{
    fileId: string
    fileName: string
    mimeType: string
    size: number
    groupId: string
    groupName: string
    role: SharedRole
    sharedAt: Date
  }> = []

  for (const membership of memberships) {
    const shares = await getGroupFileShares(membership.groupId)
    const group = await getGroupById(membership.groupId)

    for (const share of shares) {
      const key = `${share.fileId}:${share.groupId}`
      if (seen.has(key)) continue
      seen.add(key)

      const file = await getFileById(share.fileId)
      if (!file || file.userId === userId) continue

      const effectiveRole: SharedRole =
        membership.role === 'admin' || membership.role === 'editor'
          ? share.role === 'editor'
            ? 'editor'
            : 'viewer'
          : 'viewer'

      results.push({
        fileId: share.fileId,
        fileName: file.originalName,
        mimeType: file.mimeType,
        size: file.size,
        groupId: share.groupId,
        groupName: group?.name ?? 'Unknown Group',
        role: effectiveRole,
        sharedAt: share.createdAt,
      })
    }
  }

  return results
}
