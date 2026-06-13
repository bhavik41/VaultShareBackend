import { createAuditLog, getAuditLogsByFile, getAuditLogsByUser, getAuditLogCountByAction, AuditAction, AuditLog } from "../db/auditStore"
import { requireFileAccess } from "../utils/accessControl"
import { findUserById } from "../db/inMemoryStore"
import { getFileById } from "../db/fileStore"

export interface EnrichedAuditLog extends AuditLog {
  userName: string
  userEmail: string
  fileOwnerName: string
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
): void {
  createAuditLog(fileId, userId, action, details).catch((err) => {
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

  let logs = await getAuditLogsByFile(fileId, filters)

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
      return { ...log, userName: cached.name, userEmail: cached.email, fileOwnerName }
    }),
  )

  // Build audit summary for the file
  const byAction = await getAuditLogCountByAction(fileId)
  const uniqueUsers = new Set(logs.map((l) => l.userId)).size
  const lastActivityAt = logs.length > 0 ? logs[0].timestamp : null
  const summary: AuditSummary = {
    totalEvents: total,
    byAction,
    uniqueUsers,
    lastActivityAt,
  }

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
