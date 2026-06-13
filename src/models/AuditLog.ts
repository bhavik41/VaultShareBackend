import { Schema, model } from "mongoose"

export type AuditAction =
  | "upload"
  | "download"
  | "view"
  | "share"
  | "permission_change"
  | "delete"

export interface IAuditLog {
  _id: string
  fileId: string
  userId: string
  action: AuditAction
  details?: string
  ipAddress?: string
  userAgent?: string
  timestamp: Date
}

const auditLogSchema = new Schema<IAuditLog>({
  _id: { type: String },
  fileId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  action: {
    type: String,
    enum: ["upload", "download", "view", "share", "permission_change", "delete"],
    required: true,
  },
  details: { type: String },
  ipAddress: { type: String },
  userAgent: { type: String },
  timestamp: { type: Date, default: () => new Date(), index: true },
})

// Compound index for fast per-file time-range queries
auditLogSchema.index({ fileId: 1, timestamp: -1 })
// Compound index for fast per-user activity queries
auditLogSchema.index({ userId: 1, timestamp: -1 })

export const AuditLogModel = model<IAuditLog>("AuditLog", auditLogSchema)
