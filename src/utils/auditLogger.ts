import { Request } from "express"
import { createAuditLog, createViewLogDeduped, AuditAction } from "../db/auditStore"

function requestMetadata(req: Request): { ipAddress: string; userAgent: string } {
  const ipAddress =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket?.remoteAddress ??
    "unknown"
  const userAgent = req.headers["user-agent"] ?? "unknown"
  return { ipAddress, userAgent }
}

/**
 * Fire-and-forget audit log writer.
 * Reads ip and user-agent from the Express request automatically.
 */
export function logAction(
  req: Request,
  fileId: string,
  userId: string,
  action: AuditAction,
  details?: string,
): void {
  createAuditLog(fileId, userId, action, details, requestMetadata(req)).catch((err) => {
    console.error("[audit] Failed to write audit log:", err)
  })
}

/**
 * Fire-and-forget "view" log writer, deduped per file+user within a short
 * window (AUDIT_VIEW_DEDUP_WINDOW_MS) so repeated preview/view requests —
 * from React StrictMode double-effects, retries, or rapid re-opens — don't
 * create duplicate audit rows.
 */
export function logViewAction(req: Request, fileId: string, userId: string): void {
  createViewLogDeduped(fileId, userId, requestMetadata(req)).catch((err) => {
    console.error("[audit] Failed to write view audit log:", err)
  })
}
