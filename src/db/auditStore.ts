import { v4 as uuidv4 } from "uuid"
import { AuditLogModel } from "../models/AuditLog"

export type AuditAction =
  | "upload"
  | "download"
  | "view"
  | "share"
  | "permission_change"
  | "delete"

export interface AuditLog {
  id: string
  fileId: string
  userId: string
  action: AuditAction
  details?: string
  ipAddress?: string
  userAgent?: string
  timestamp: Date
}

function toAuditLog(doc: any): AuditLog {
  return {
    id: doc._id,
    fileId: doc.fileId,
    userId: doc.userId,
    action: doc.action,
    details: doc.details,
    ipAddress: doc.ipAddress,
    userAgent: doc.userAgent,
    timestamp: doc.timestamp,
  }
}

export const createAuditLog = async (
  fileId: string,
  userId: string,
  action: AuditAction,
  details?: string,
  meta?: { ipAddress?: string; userAgent?: string },
): Promise<AuditLog> => {
  const doc = await AuditLogModel.create({
    _id: uuidv4(),
    fileId,
    userId,
    action,
    details,
    ipAddress: meta?.ipAddress,
    userAgent: meta?.userAgent,
    timestamp: new Date(),
  })
  return toAuditLog(doc)
}

export const getAuditLogsByFile = async (
  fileId: string,
  filters?: { action?: AuditAction },
): Promise<AuditLog[]> => {
  const query: Record<string, unknown> = { fileId }
  if (filters?.action) query.action = filters.action
  const docs = await AuditLogModel.find(query).sort({ timestamp: -1 })
  return docs.map(toAuditLog)
}

export const getAuditLogsByUser = async (
  userId: string,
  options?: { actions?: AuditAction[]; limit?: number; offset?: number },
): Promise<{ logs: AuditLog[]; total: number }> => {
  const query: Record<string, unknown> = { userId }
  if (options?.actions?.length) query.action = { $in: options.actions }

  const total = await AuditLogModel.countDocuments(query)
  const docs = await AuditLogModel.find(query)
    .sort({ timestamp: -1 })
    .skip(options?.offset ?? 0)
    .limit(options?.limit ?? 50)

  return { logs: docs.map(toAuditLog), total }
}

export const getAuditLogCountByAction = async (
  fileId: string,
): Promise<Record<AuditAction, number>> => {
  const result = await AuditLogModel.aggregate([
    { $match: { fileId } },
    { $group: { _id: "$action", count: { $sum: 1 } } },
  ])
  const counts: Record<string, number> = {}
  result.forEach((r) => { counts[r._id] = r.count })
  return counts as Record<AuditAction, number>
}
