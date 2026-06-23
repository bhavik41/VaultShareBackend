import { Request, Response } from "express";
import * as fileService from "../services/file.service";
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
  if (message.includes("expired") || message.includes("revoked")) return 410;
  return 400;
}

export class CollaborationController {
  static async inviteCollaborator(req: Request, res: Response): Promise<void> {
    try {
      const { fileId } = req.params;
      const { inviteeEmail, role } = req.body;

      if (!inviteeEmail || !role) {
        res.status(400).json({
          message: "inviteeEmail and role are required.",
        });
        return;
      }

      const invitation = await collaborationService.inviteCollaborator({
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

  static async listMyInvitations(req: Request, res: Response): Promise<void> {
    try {
      const invitations = await collaborationService.listMyInvitations(req.user!.id);
      res.status(200).json({ invitations });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  static async listFileInvitations(req: Request, res: Response): Promise<void> {
    try {
      const { fileId } = req.params;
      const invitations = await collaborationService.listFileInvitations(
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

  static async respondToInvitation(req: Request, res: Response): Promise<void> {
    try {
      const { invitationId } = req.params;
      const { status } = req.body;

      const result = await collaborationService.respondToInvitation(
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

  static async shareFileWithUser(req: Request, res: Response): Promise<void> {
    try {
      const { fileId } = req.params;
      const { collaboratorEmail, role } = req.body;

      if (!collaboratorEmail || !role) {
        res.status(400).json({
          message: "collaboratorEmail and role are required.",
        });
        return;
      }

      const share = await collaborationService.shareFileWithUser({
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

  static async listSharedUsers(req: Request, res: Response): Promise<void> {
    try {
      const { fileId } = req.params;
      const collaborators = await collaborationService.listSharedUsers(
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

  static async updateCollaboratorPermission(req: Request, res: Response): Promise<void> {
    try {
      const { fileId, userId } = req.params;
      const { role } = req.body;

      if (!role) {
        res.status(400).json({ message: "role is required." });
        return;
      }

      const share = await collaborationService.updateCollaboratorPermission(
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

  static async removeCollaborator(req: Request, res: Response): Promise<void> {
    try {
      const { fileId, userId } = req.params;

      await collaborationService.removeCollaborator(fileId, req.user!.id, userId);

      res.status(200).json({
        message: "Collaborator removed successfully.",
      });
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({
        message: error.message,
      });
    }
  }

  static async listFilesSharedWithMe(req: Request, res: Response): Promise<void> {
    try {
      const files = await collaborationService.listFilesSharedWithMe(req.user!.id);
      res.status(200).json({ files });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  static async createShareLink(req: Request, res: Response): Promise<void> {
    try {
      const { fileId } = req.params;
      const { permissionMode, expiresAt } = req.body;

      if (!permissionMode) {
        res.status(400).json({ message: "permissionMode is required." });
        return;
      }

      const shareLink = await collaborationService.createFileShareLink({
        fileId,
        ownerId: req.user!.id,
        permissionMode,
        expiresAt,
      });

      res.status(201).json({
        message: "Share link created successfully.",
        shareLink,
      });
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({
        message: error.message,
      });
    }
  }

  static async listShareLinks(req: Request, res: Response): Promise<void> {
    try {
      const { fileId } = req.params;

      const shareLinks = await collaborationService.listFileShareLinks(
        fileId,
        req.user!.id,
      );

      res.status(200).json({ shareLinks });
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({
        message: error.message,
      });
    }
  }

  static async revokeShareLink(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.params;
      const shareLink = await collaborationService.revokeFileShareLink(
        token,
        req.user!.id,
      );

      res.status(200).json({
        message: "Share link revoked successfully.",
        shareLink,
      });
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({
        message: error.message,
      });
    }
  }

  static async downloadShareLink(req: Request, res: Response): Promise<void> {
    try {
      const validation = req.shareLinkValidation;
      if (!validation) {
        res.status(500).json({ message: "Share link validation missing." });
        return;
      }

      const { file } = validation;
      const { stream, originalName, mimeType, size } =
        await fileService.streamFileDownloadForShareLink(file.id);

      res.setHeader("Content-Type", mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(originalName)}"`,
      );
      res.setHeader("Content-Length", size);
      res.setHeader("Cache-Control", "private, no-cache");

      stream.on("error", (err) => {
        console.error("[share-download] GCS stream error:", err);
        res.end();
      });

      stream.pipe(res);
    } catch (error: any) {
      const message = error.message;
      const status =
        message === "Share link not found."
          ? 404
          : message.includes("expired") || message.includes("revoked")
          ? 410
          : message === "Authentication required."
          ? 401
          : message === "Only the file owner may download using this link."
          ? 403
          : message === "File not found."
          ? 404
          : 500;
      res.status(status).json({ message });
    }
  }

  static async validateShareLink(req: Request, res: Response): Promise<void> {
    try {
      const { token } = req.params;
      const result = await collaborationService.validateShareLinkToken(token);

      res.status(200).json({
        message: "Share link is valid.",
        ...result,
      });
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({
        message: error.message,
      });
    }
  }

  // ── Methods added by feature/backend-audit-log ────────────────────────────

  static async getPendingInvitations(req: Request, res: Response): Promise<void> {
    try {
      const invitations = await collaborationService.getPendingInvitations(req.user!.id);
      res.status(200).json({ invitations });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  static async acceptInvitation(req: Request, res: Response): Promise<void> {
    try {
      const { invitationId } = req.params;
      const result = await collaborationService.acceptInvitation(req.user!.id, invitationId);
      res.status(200).json({ message: "Invitation accepted.", ...result });
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message });
    }
  }

  static async rejectInvitation(req: Request, res: Response): Promise<void> {
    try {
      const { invitationId } = req.params;
      const result = await collaborationService.rejectInvitation(req.user!.id, invitationId);
      res.status(200).json({ message: "Invitation rejected.", ...result });
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message });
    }
  }

  static async changeRole(req: Request, res: Response): Promise<void> {
    try {
      const { fileId, userId } = req.params;
      const { role } = req.body;

      if (!role) {
        res.status(400).json({ message: "role is required." });
        return;
      }

      const share = await collaborationService.changeRole(req.user!.id, fileId, userId, role);
      res.status(200).json({ message: "Role updated successfully.", share });
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message });
    }
  }

  static async revokeAccess(req: Request, res: Response): Promise<void> {
    try {
      const { fileId, userId } = req.params;
      await collaborationService.revokeAccess(req.user!.id, fileId, userId);
      res.status(200).json({ message: "Access revoked successfully." });
    } catch (error: any) {
      res.status(getErrorStatus(error.message)).json({ message: error.message });
    }
  }
}
