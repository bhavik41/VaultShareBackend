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
