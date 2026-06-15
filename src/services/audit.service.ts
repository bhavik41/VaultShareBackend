import { createAuditLog, getAuditLogsByFile, getAuditLogsByUser, getAuditLogCountByAction, AuditAction, AuditLog } from "../db/auditStore"
import { requireFileAccess } from "../utils/accessControl"
import { findUserById } from "../db/inMemoryStore"
import { getFileById } from "../db/fileStore"

export interface EnrichedAuditLog extends AuditLog {
  userName: string
  userEmail: string
  fileOwnerName: string
  fileOwnerId: string
}

export interface AuditSummary {
  totalEvents: number
  byAction: Record<AuditAction, number>
  uniqueUsers: number
  lastActivityAt: Date | null
}

export function logAction(
  fileId: string,
  userId: string,
  action: AuditAction,
  details?: string,
  metadata?: Record<string, unknown>,
): void {
  createAuditLog(fileId, userId, action, details, metadata).catch((err) => {
    console.error("[audit] Failed to write audit log:", err)
  })
}

export async function getFileAuditHistory(
  fileId: string,
  requestingUserId: string,
  filters?: { action?: AuditAction },
  pagination?: { limit?: number; offset?: number },
): Promise<{ logs: EnrichedAuditLog[]; total: number; fileOwnerName: string; fileOwnerId: string; summary: AuditSummary }> {
  const { file } = await requireFileAccess(fileId, requestingUserId, "owner")

  const fileOwner = await findUserById(file.userId)
  const fileOwnerName = fileOwner?.name ?? "Unknown"
  const fileOwnerId = file.userId

  const logs = await getAuditLogsByFile(fileId, filters)
  const total = logs.length
  const limit = pagination?.limit ?? 50
  const offset = pagination?.offset ?? 0
  const paginated = logs.slice(offset, offset + limit)

  const userCache = new Map<string, { name: string; email: string }>()
  const enrichedLogs: EnrichedAuditLog[] = await Promise.all(
    paginated.map(async (log) => {
      let cached = userCache.get(log.userId)
      if (!cached) {
        const user = await findUserById(log.userId)
        cached = { name: user?.name ?? "Unknown User", email: user?.email ?? "" }
        userCache.set(log.userId, cached)
      }
      return { ...log, userName: cached.name, userEmail: cached.email, fileOwnerName, fileOwnerId }
    }),
  )

  const byAction = await getAuditLogCountByAction(fileId)
  const uniqueUsers = new Set(logs.map((l) => l.userId)).size
  const lastActivityAt = logs.length > 0 ? logs[0].timestamp : null
  const summary: AuditSummary = { totalEvents: total, byAction, uniqueUsers, lastActivityAt }

  return { logs: enrichedLogs, total, fileOwnerName, fileOwnerId, summary }
}

export interface UserActivity extends AuditLog {
  fileName: string
  mimeType: string
}

export async function getUserActivityHistory(
  userId: string,
  filters?: { actions?: AuditAction[] },
  pagination?: { limit?: number; offset?: number },
): Promise<{ activities: UserActivity[]; total: number }> {
  const { logs, total } = await getAuditLogsByUser(userId, {
    actions: filters?.actions,
    limit: pagination?.limit ?? 50,
    offset: pagination?.offset ?? 0,
  })

  const fileCache = new Map<string, { name: string; mimeType: string }>()
  const activities: UserActivity[] = await Promise.all(
    logs.map(async (log) => {
      let cached = fileCache.get(log.fileId)
      if (!cached) {
        const file = await getFileById(log.fileId)
        cached = {
          name: file?.originalName ?? "Unknown file",
          mimeType: file?.mimeType ?? "application/octet-stream",
        }
        fileCache.set(log.fileId, cached)
      }
      return { ...log, fileName: cached.name, mimeType: cached.mimeType }
    }),
  )

  return { activities, total }
}

export interface UserStats {
  totalEvents: number
  todayEvents: number
  topAction: AuditAction | null
}

export async function getUserStats(userId: string): Promise<UserStats> {
  const { logs, total } = await getAuditLogsByUser(userId, { limit: 1000 })
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayEvents = logs.filter((l) => new Date(l.timestamp) >= today).length
  const actionCounts: Partial<Record<AuditAction, number>> = {}
  for (const l of logs) actionCounts[l.action] = (actionCounts[l.action] ?? 0) + 1
  const topAction = Object.entries(actionCounts).sort(([, a], [, b]) => b - a)[0]?.[0] as AuditAction | null
  return { totalEvents: total, todayEvents, topAction }
}
