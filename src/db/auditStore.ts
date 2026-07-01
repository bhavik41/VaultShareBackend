import { v4 as uuidv4 } from "uuid"
import { AuditLogModel, IAuditLog, AuditAction } from "../models/AuditLog"

export type { AuditAction }

export interface AuditLog extends IAuditLog {}

export async function createAuditLog(
  fileId: string,
  userId: string,
  action: AuditAction,
  details?: string,
  metadata?: Record<string, unknown>,
): Promise<AuditLog> {
  const doc = new AuditLogModel({
    _id: uuidv4(),
    fileId,
    userId,
    action,
    details,
    metadata,
    timestamp: new Date(),
  })
  await doc.save()
  return doc.toObject()
}

export async function getAuditLogsByFile(
  fileId: string,
  filters?: { action?: AuditAction },
): Promise<AuditLog[]> {
  const query: Record<string, unknown> = { fileId }
  if (filters?.action) query.action = filters.action
  return AuditLogModel.find(query).sort({ timestamp: -1 }).lean()
}

export async function getAuditLogsByUser(
  userId: string,
  opts?: { actions?: AuditAction[]; limit?: number; offset?: number },
): Promise<{ logs: AuditLog[]; total: number }> {
  const query: Record<string, unknown> = { userId }
  if (opts?.actions?.length) query.action = { $in: opts.actions }
  const total = await AuditLogModel.countDocuments(query)
  const logs = await AuditLogModel.find(query)
    .sort({ timestamp: -1 })
    .skip(opts?.offset ?? 0)
    .limit(opts?.limit ?? 50)
    .lean()
  return { logs, total }
}

export async function getAuditLogCountByAction(
  fileId: string,
): Promise<Record<AuditAction, number>> {
  const counts = await AuditLogModel.aggregate([
    { $match: { fileId } },
    { $group: { _id: "$action", count: { $sum: 1 } } },
  ])
  const result: Partial<Record<AuditAction, number>> = {}
  for (const c of counts) result[c._id as AuditAction] = c.count
  return result as Record<AuditAction, number>
}

export async function getAuditLogsByDateRange(
  fileId: string,
  from: Date,
  to: Date,
  opts?: { limit?: number; offset?: number }
): Promise<AuditLog[]> {
  return AuditLogModel.find({ fileId, timestamp: { $gte: from, $lte: to } })
    .sort({ timestamp: -1 })
    .skip(opts?.offset ?? 0)
    .limit(opts?.limit ?? 50)
    .lean()
}

// Dedup: prevent duplicate view logs within a short window (race-condition safe)
const viewDebounce = new Map<string, number>()
export async function createViewLogDeduped(
  fileId: string,
  userId: string,
  metadata?: Record<string, unknown>,
  windowMs = parseInt(process.env.AUDIT_VIEW_DEDUP_WINDOW_MS ?? "5000", 10),
): Promise<void> {
  const key = `${fileId}:${userId}`
  const last = viewDebounce.get(key) ?? 0
  if (Date.now() - last < windowMs) return
  viewDebounce.set(key, Date.now())
  await createAuditLog(fileId, userId, "view", undefined, metadata)
}
