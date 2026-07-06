import { Request, Response } from "express";
import * as versionService from "../services/version.service";
import { StoredFileVersion } from "../db/fileVersionStore";
import { StoredVersionRequest } from "../db/versionRequestStore";

function statusForError(message: string): number {
  if (message === "Access denied.") return 403;
  if (message.includes("not found")) return 404;
  return 400;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[\r\n"/\\]/g, "_");
}

// Internal S3 object keys are never sent to the client.
function toClientVersion(v: StoredFileVersion) {
  const { s3Key, ...rest } = v;
  return rest;
}

function toClientRequest(r: StoredVersionRequest) {
  const { stagingS3Key, ...rest } = r;
  return rest;
}

export class VersionController {
  static async listVersions(req: Request, res: Response): Promise<void> {
    try {
      const versions = await versionService.listVersions(req.params.fileId, req.user!.id);
      res.status(200).json({ versions: versions.map(toClientVersion) });
    } catch (error: any) {
      res.status(statusForError(error.message)).json({ message: error.message });
    }
  }

  static async uploadVersion(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No file provided." });
        return;
      }
      const isEncrypted = req.body.encrypted === "true";
      const changeNote = typeof req.body.changeNote === "string" ? req.body.changeNote : undefined;
      const version = await versionService.uploadVersionDirect(req.params.fileId, req.user!.id, req.file, {
        changeNote,
        isEncrypted,
      });
      res.status(201).json({ version: toClientVersion(version) });
    } catch (error: any) {
      res.status(statusForError(error.message)).json({ message: error.message });
    }
  }

  static async requestVersion(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No file provided." });
        return;
      }
      const isEncrypted = req.body.encrypted === "true";
      const changeNote = typeof req.body.changeNote === "string" ? req.body.changeNote : undefined;
      const request = await versionService.requestVersionUpload(req.params.fileId, req.user!.id, req.file, {
        changeNote,
        isEncrypted,
      });
      res.status(201).json({ request: toClientRequest(request) });
    } catch (error: any) {
      res.status(statusForError(error.message)).json({ message: error.message });
    }
  }

  static async listPendingRequests(req: Request, res: Response): Promise<void> {
    try {
      const requests = await versionService.listPendingRequests(req.params.fileId, req.user!.id);
      res.status(200).json({ requests: requests.map(toClientRequest) });
    } catch (error: any) {
      res.status(statusForError(error.message)).json({ message: error.message });
    }
  }

  static async getMyPendingRequest(req: Request, res: Response): Promise<void> {
    try {
      const request = await versionService.getMyPendingRequest(req.params.fileId, req.user!.id);
      res.status(200).json({ request: request ? toClientRequest(request) : null });
    } catch (error: any) {
      res.status(statusForError(error.message)).json({ message: error.message });
    }
  }

  static async getMyRejectedRequests(req: Request, res: Response): Promise<void> {
    try {
      const requests = await versionService.getMyRejectedRequests(req.params.fileId, req.user!.id);
      res.status(200).json({ requests: requests.map(toClientRequest) });
    } catch (error: any) {
      res.status(statusForError(error.message)).json({ message: error.message });
    }
  }

  static async listPendingRequestsForOwner(req: Request, res: Response): Promise<void> {
    try {
      const requests = await versionService.listPendingRequestsForOwner(req.user!.id);
      res.status(200).json({ requests: requests.map(toClientRequest) });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  static async approveRequest(req: Request, res: Response): Promise<void> {
    try {
      const version = await versionService.approveVersionRequest(
        req.params.fileId,
        req.params.requestId,
        req.user!.id,
      );
      res.status(200).json({ version: toClientVersion(version) });
    } catch (error: any) {
      res.status(statusForError(error.message)).json({ message: error.message });
    }
  }

  static async rejectRequest(req: Request, res: Response): Promise<void> {
    try {
      const request = await versionService.rejectVersionRequest(
        req.params.fileId,
        req.params.requestId,
        req.user!.id,
      );
      res.status(200).json({ request: toClientRequest(request) });
    } catch (error: any) {
      res.status(statusForError(error.message)).json({ message: error.message });
    }
  }

  static async activateVersion(req: Request, res: Response): Promise<void> {
    try {
      const version = await versionService.activateVersion(
        req.params.fileId,
        req.params.versionId,
        req.user!.id,
      );
      res.status(200).json({ version: toClientVersion(version) });
    } catch (error: any) {
      res.status(statusForError(error.message)).json({ message: error.message });
    }
  }

  static async downloadVersion(req: Request, res: Response): Promise<void> {
    try {
      const { stream, version, fileName } = await versionService.downloadVersion(
        req.params.fileId,
        req.params.versionId,
        req.user!.id,
      );
      const safeFilename = sanitizeFilename(`v${version.versionNumber}_${fileName}`);
      res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
      res.setHeader("Content-Type", version.mimeType);
      stream.pipe(res);
    } catch (error: any) {
      res.status(statusForError(error.message)).json({ message: error.message });
    }
  }

  static async deleteVersion(req: Request, res: Response): Promise<void> {
    try {
      await versionService.deleteVersion(req.params.fileId, req.params.versionId, req.user!.id);
      res.status(200).json({ message: "Version deleted." });
    } catch (error: any) {
      res.status(statusForError(error.message)).json({ message: error.message });
    }
  }

  static async updatePolicy(req: Request, res: Response): Promise<void> {
    try {
      const policy = await versionService.updateVersionPolicy(
        req.params.fileId,
        req.user!.id,
        req.body.versionPolicy,
      );
      res.status(200).json({ versionPolicy: policy });
    } catch (error: any) {
      res.status(statusForError(error.message)).json({ message: error.message });
    }
  }
}
