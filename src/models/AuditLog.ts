import { Schema, model } from "mongoose"

export type AuditAction =
  | "upload"
  | "download"
  | "view"
  | "share"
  | "permission_change"
  | "delete"
  | "revoke_access"
  | "star"
  | "invitation_accepted"

export interface IAuditLog {
  _id: string
  fileId: string
  userId: string
  action: AuditAction
  details?: string
  ipAddress?: string
  userAgent?: string
  metadata?: Record<string, unknown>
  timestamp: Date
}

const auditLogSchema = new Schema<IAuditLog>({
  _id: { type: String },
  fileId: { type: String, required: true, index: true },
  userId: { type: String, required: true, index: true },
  action: {
    type: String,
    enum: [
      "upload", "download", "view", "share",
      "permission_change", "delete", "revoke_access", "star",
      "invitation_accepted",
    ],
    required: true,
  },
  details: { type: String },
  ipAddress: { type: String },
  userAgent: { type: String },
  metadata: { type: Schema.Types.Mixed },
  timestamp: { type: Date, default: () => new Date(), index: true },
})

// Compound indexes for fast per-file and per-user time-range queries
auditLogSchema.index({ fileId: 1, timestamp: -1 })
auditLogSchema.index({ userId: 1, timestamp: -1 })
auditLogSchema.index({ userId: 1, action: 1, timestamp: -1 })

export const AuditLogModel = model<IAuditLog>("AuditLog", auditLogSchema)
