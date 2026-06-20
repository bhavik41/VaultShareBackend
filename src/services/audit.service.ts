import { createAuditLog, getAuditLogsByFile, AuditAction, AuditLog } from "../db/auditStore";
import { requireFileAccess } from "../utils/accessControl";

/**
 * Log an action performed on a file.
 */
export function logAction(
  fileId: string,
  userId: string,
  action: AuditAction,
  details?: string
): void {
  createAuditLog(fileId, userId, action, details);
}

/**
 * Retrieve audit history for a file.
 * Only the file owner is allowed to view audit logs.
 */
export function getFileAuditHistory(
  fileId: string,
  requestingUserId: string,
  filters?: { action?: AuditAction },
  pagination?: { limit?: number; offset?: number }
): { logs: AuditLog[]; total: number } {
  // Ensure only the owner can access audit logs
  requireFileAccess(fileId, requestingUserId, "owner");

  let logs = getAuditLogsByFile(fileId);

  // Apply filters
  if (filters?.action) {
    logs = logs.filter((log) => log.action === filters.action);
  }

  const total = logs.length;

  // Apply pagination
  const limit = pagination?.limit ?? 50;
  const offset = pagination?.offset ?? 0;
  logs = logs.slice(offset, offset + limit);

  return { logs, total };
}
