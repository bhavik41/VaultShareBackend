import { Request } from "express"
import { createAuditLog, AuditAction } from "../db/auditStore"

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
  const ipAddress =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ??
    req.socket?.remoteAddress ??
    "unknown"
  const userAgent = req.headers["user-agent"] ?? "unknown"

  createAuditLog(fileId, userId, action, details, { ipAddress, userAgent }).catch((err) => {
    console.error("[audit] Failed to write audit log:", err)
  })
}
