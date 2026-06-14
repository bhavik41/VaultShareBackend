import { Request, Response } from "express"
import * as collaborationService from "../services/collaboration.service"
import { logAction } from "../services/audit.service"

export class CollaborationController {
  static async getPendingInvitations(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id
      const invitations = await collaborationService.getPendingInvitations(userId)
      res.status(200).json({ invitations })
    } catch (error: any) {
      res.status(500).json({ message: error.message })
    }
  }

  static async inviteCollaborator(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = req.user!.id
      const { fileId, email, role } = req.body
      const result = await collaborationService.inviteCollaborator(ownerId, fileId, email, role)
      logAction(fileId, ownerId, "share", Invited  as )
      res.status(201).json(result)
    } catch (error: any) {
      const status = error.message?.includes("not found") ? 404
        : error.message?.includes("already") ? 409 : 500
      res.status(status).json({ message: error.message })
    }
  }

  static async acceptInvitation(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id
      const { invitationId } = req.params
      const result = await collaborationService.acceptInvitation(userId, invitationId)
      if (result.fileId) logAction(result.fileId, userId, "invitation_accepted")
      res.status(200).json(result)
    } catch (error: any) {
      // Show real error message on frontend
      const status = error.message?.includes("not found") ? 404
        : error.message?.includes("already") ? 409 : 500
      res.status(status).json({ message: error.message })
    }
  }

  static async rejectInvitation(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id
      const { invitationId } = req.params
      const result = await collaborationService.rejectInvitation(userId, invitationId)
      res.status(200).json(result)
    } catch (error: any) {
      res.status(500).json({ message: error.message })
    }
  }

  static async changeRole(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = req.user!.id
      const { fileId, userId } = req.params
      const { role } = req.body
      const result = await collaborationService.changeRole(ownerId, fileId, userId, role)
      logAction(fileId, ownerId, "permission_change", Changed  role to )
      res.status(200).json(result)
    } catch (error: any) {
      const status = error.message?.includes("Access denied") ? 403 : 500
      res.status(status).json({ message: error.message })
    }
  }

  static async revokeAccess(req: Request, res: Response): Promise<void> {
    try {
      const ownerId = req.user!.id
      const { fileId, userId } = req.params
      await collaborationService.revokeAccess(ownerId, fileId, userId)
      logAction(fileId, ownerId, "revoke_access", Revoked access for )
      res.status(200).json({ message: "Access revoked successfully" })
    } catch (error: any) {
      const status = error.message?.includes("Access denied") ? 403 : 500
      res.status(status).json({ message: error.message })
    }
  }
}
