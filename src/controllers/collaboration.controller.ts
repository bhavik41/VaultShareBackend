import { Request, Response } from "express";
import * as collaborationService from "../services/collaboration.service";

function getErrorStatus(message: string): number {
  if (message === "Access denied.") return 403;
  if (message.includes("not found")) return 404;
  if (
    message.includes("already") ||
    message.includes("pending invitation") ||
    message.includes("already has access")
  ) {
    return 409;
  }
  return 400;
}

export class CollaborationController {
  static inviteCollaborator(req: Request, res: Response): void {
    try {
      const { fileId } = req.params;
      const { inviteeEmail, role } = req.body;

      if (!inviteeEmail || !role) {
        res.status(400).json({
          message: "inviteeEmail and role are required.",
        });
        return;
      }

      const invitation = collaborationService.inviteCollaborator({
        fileId,
        inviterId: req.user!.id,
        inviteeEmail,
        role,
      });

      res.status(201).json({
        message: "Invitation created successfully.",
        invitation,
      });
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({
        message: error.message,
      });
    }
  }

  static listMyInvitations(req: Request, res: Response): void {
    try {
      const invitations = collaborationService.listMyInvitations(req.user!.id);
      res.status(200).json({ invitations });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  static listFileInvitations(req: Request, res: Response): void {
    try {
      const { fileId } = req.params;
      const invitations = collaborationService.listFileInvitations(
        fileId,
        req.user!.id,
      );

      res.status(200).json({ invitations });
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({
        message: error.message,
      });
    }
  }

  static respondToInvitation(req: Request, res: Response): void {
    try {
      const { invitationId } = req.params;
      const { status } = req.body;

      const result = collaborationService.respondToInvitation(
        invitationId,
        req.user!.id,
        status,
      );

      res.status(200).json({
        message: `Invitation ${status}.`,
        ...result,
      });
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({
        message: error.message,
      });
    }
  }

  static shareFileWithUser(req: Request, res: Response): void {
    try {
      const { fileId } = req.params;
      const { collaboratorEmail, role } = req.body;

      if (!collaboratorEmail || !role) {
        res.status(400).json({
          message: "collaboratorEmail and role are required.",
        });
        return;
      }

      const share = collaborationService.shareFileWithUser({
        fileId,
        ownerId: req.user!.id,
        collaboratorEmail,
        role,
      });

      res.status(201).json({
        message: "File shared successfully.",
        share,
      });
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({
        message: error.message,
      });
    }
  }

  static listSharedUsers(req: Request, res: Response): void {
    try {
      const { fileId } = req.params;
      const collaborators = collaborationService.listSharedUsers(
        fileId,
        req.user!.id,
      );

      res.status(200).json({ collaborators });
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({
        message: error.message,
      });
    }
  }

  static updateCollaboratorPermission(req: Request, res: Response): void {
    try {
      const { fileId, userId } = req.params;
      const { role } = req.body;

      if (!role) {
        res.status(400).json({ message: "role is required." });
        return;
      }

      const share = collaborationService.updateCollaboratorPermission(
        fileId,
        req.user!.id,
        userId,
        role,
      );

      res.status(200).json({
        message: "Collaborator permission updated.",
        share,
      });
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({
        message: error.message,
      });
    }
  }

  static removeCollaborator(req: Request, res: Response): void {
    try {
      const { fileId, userId } = req.params;

      collaborationService.removeCollaborator(fileId, req.user!.id, userId);

      res.status(200).json({
        message: "Collaborator removed successfully.",
      });
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({
        message: error.message,
      });
    }
  }

  static listFilesSharedWithMe(req: Request, res: Response): void {
    try {
      const files = collaborationService.listFilesSharedWithMe(req.user!.id);
      res.status(200).json({ files });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
}