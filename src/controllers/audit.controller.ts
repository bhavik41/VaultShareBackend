import { Request, Response } from "express";
import * as auditService from "../services/audit.service";
import { AuditAction } from "../db/auditStore";

export class AuditController {
  static getAuditHistory(req: Request, res: Response): void {
    try {
      const { fileId } = req.params;
      const userId = req.user!.id;
      
      const { action, limit, offset } = req.query;

      const filters: { action?: AuditAction } = {};
      if (action && typeof action === "string") {
        filters.action = action as AuditAction;
      }

      const pagination: { limit?: number; offset?: number } = {};
      if (limit && typeof limit === "string") {
        pagination.limit = parseInt(limit, 10);
      }
      if (offset && typeof offset === "string") {
        pagination.offset = parseInt(offset, 10);
      }

      const result = auditService.getFileAuditHistory(
        fileId,
        userId,
        filters,
        pagination
      );

      res.status(200).json(result);
    } catch (error: any) {
      const status = error.message === "Access denied." ? 403 : error.message === "File not found." ? 404 : 500;
      res.status(status).json({ message: error.message });
    }
  }
}
