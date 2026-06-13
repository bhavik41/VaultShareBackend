import { Request, Response } from "express"
import * as collaborationService from "../services/collaboration.service"
import { logAction } from "../utils/auditLogger"

export class CollaborationController {
  static async shareFile(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = req.user!.id
      const { fileId } = req.params
      const { email, permission } = req.body
      const result = await collaborationService.shareFile(fileId, ownerId, email, permission)
      // Audit: log share action with collaborator email
      logAction(req, fileId, ownerId, "share", `Shared with ${email} (${permission})`)
      res.status(200).json(result)
    } catch (error: any) {
      const status = error.message === "Access denied." ? 403 : error.message === "File not found." ? 404 : 500
      res.status(status).json({ message: error.message })
    }
  }

  static async updatePermission(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = req.user!.id
      const { fileId, collaboratorId } = req.params
      const { permission } = req.body
      await collaborationService.updatePermission(fileId, ownerId, collaboratorId, permission)
      // Audit: log permission change
      logAction(req, fileId, ownerId, "permission_change", `Changed collaborator ${collaboratorId} to ${permission}`)
      res.status(200).json({ message: "Permission updated." })
    } catch (error: any) {
      const status = error.message === "Access denied." ? 403 : 500
      res.status(status).json({ message: error.message })
    }
  }

  static async removeCollaborator(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = req.user!.id
      const { fileId, collaboratorId } = req.params
      await collaborationService.removeCollaborator(fileId, ownerId, collaboratorId)
      logAction(req, fileId, ownerId, "permission_change", `Removed collaborator ${collaboratorId}`)
      res.status(200).json({ message: "Collaborator removed." })
    } catch (error: any) {
      res.status(500).json({ message: error.message })
    }
  }
}
