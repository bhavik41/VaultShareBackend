import { Request, Response } from "express"
import * as auditService from "../services/audit.service"
import { AuditAction } from "../db/auditStore"
import { getAuditLogsByDateRange } from "../db/auditStore"

export class AuditController {
  /**
   * GET /api/audit/my-activity
   * Returns the authenticated user's own audit trail across all files.
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
   * Returns the full audit history for a specific file.
   * Owner-only: returns 403 if requesting user is not the file owner.
   * Includes enriched user info (name + email) and per-action summary stats.
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

  /**
   * GET /api/files/:fileId/audit/range?from=&to=
   * Returns audit logs for a file within a date range (owner only).
   */
  static async getAuditHistoryByDateRange(req: Request, res: Response): Promise<void> {
    try {
      const { fileId } = req.params
      const { from, to } = req.query
      if (!from || !to) {
        res.status(400).json({ message: "from and to query params are required" })
        return
      }
      const fromDate = new Date(from as string)
      const toDate = new Date(to as string)
      if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
        res.status(400).json({ message: "Invalid date format" })
        return
      }
      const logs = await getAuditLogsByDateRange(fileId, fromDate, toDate)
      res.status(200).json({ logs })
    } catch (error: any) {
      res.status(500).json({ message: error.message })
    }
  }

  /**
   * GET /api/audit/stats
   * Returns aggregate event counts for the authenticated user's files.
   */
  static async getStats(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id
      const stats = await auditService.getUserStats(userId)
      res.status(200).json(stats)
    } catch (error: any) {
      res.status(500).json({ message: error.message })
    }
  }
}
