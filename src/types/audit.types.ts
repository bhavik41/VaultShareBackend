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
  | "version_upload"
  | "version_request"
  | "version_approved"
  | "version_rejected"
  | "version_activated"
  | "version_deleted"

export interface AuditLogEntry {
  id: string
  fileId: string
  userId: string
  userName: string
  userEmail: string
  fileOwnerName: string
  fileOwnerId: string
  action: AuditAction
  details?: string
  metadata?: Record<string, unknown>
  timestamp: Date
}

export interface AuditSummaryStats {
  totalEvents: number
  byAction: Record<AuditAction, number>
  uniqueUsers: number
  lastActivityAt: Date | null
}
