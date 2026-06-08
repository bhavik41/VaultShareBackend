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
}