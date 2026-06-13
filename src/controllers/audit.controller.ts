import { Request, Response } from "express"
import * as auditService from "../services/audit.service"
import { AuditAction } from "../db/auditStore"

export class AuditController {
  /**
   * GET /api/audit/my-activity
   * Returns the authenticated user own audit trail across all files.
   */
  static async getMyActivity(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id
      const { actions, limit, offset } = req.query

      const filters: { actions?: AuditAction[] } = {}
      if (actions && typeof actions === "string") {
        filters.actions = actions.split(",").filter(Boolean) as AuditAction[]
      }

      const pagination: { limit?: number; offset?: number } = {}
      if (limit && typeof limit === "string") pagination.limit = parseInt(limit, 10)
      if (offset && typeof offset === "string") pagination.offset = parseInt(offset, 10)

      const result = await auditService.getUserActivityHistory(userId, filters, pagination)
      res.status(200).json(result)
    } catch (error: any) {
      res.status(500).json({ message: error.message })
    }
  }

  /**
   * GET /api/files/:fileId/audit
   * Returns the full audit history for a specific file (owner only).
   * Includes enriched user info and per-action summary stats.
   */
  static async getAuditHistory(req: Request, res: Response): Promise<void> {
    try {
      const { fileId } = req.params
      const userId = req.user!.id
      const { action, limit, offset } = req.query

      const filters: { action?: AuditAction } = {}
      if (action && typeof action === "string") {
        filters.action = action as AuditAction
      }

      const pagination: { limit?: number; offset?: number } = {}
      if (limit && typeof limit === "string") pagination.limit = parseInt(limit, 10)
      if (offset && typeof offset === "string") pagination.offset = parseInt(offset, 10)

      const result = await auditService.getFileAuditHistory(fileId, userId, filters, pagination)
      res.status(200).json(result)
    } catch (error: any) {
      const status =
        error.message === "Access denied."
          ? 403
          : error.message === "File not found."
            ? 404
            : 500
      res.status(status).json({ message: error.message })
    }
  }
}
