import { Request, Response } from "express";
import * as fileService from "../services/file.service";
import { ALLOWED_MIME_TYPES } from "../middleware/upload";
import { logAction, logViewAction } from "../utils/auditLogger";

/** #41 — Strip \r and \n to prevent Content-Disposition header injection */
function sanitizeFilename(name: string): string {
  return name.replace(/[\r\n"/\\]/g, "_");
}

export class FileController {
  static async listFiles(req: Request, res: Response): Promise<void> {
    try {
      const files = await fileService.listFiles(req.user!.id);
      res.status(200).json({ files });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  static async uploadFile(req: Request, res: Response): Promise<void> {
    try {
      if (!req.file) {
        res.status(400).json({ message: "No file provided." });
        return;
      }
      const isEncrypted = req.body.encrypted === "true";

      // Validate originalMimeType is a known real MIME type, not arbitrary client input.
      let originalMimeType: string | undefined;
      if (typeof req.body.originalMimeType === "string") {
        if (!ALLOWED_MIME_TYPES.has(req.body.originalMimeType)) {
          res.status(400).json({ message: "Invalid originalMimeType." });
          return;
        }
        originalMimeType = req.body.originalMimeType;
      }

      const { file } = await fileService.uploadFile(req.user!.id, req.file, { isEncrypted, originalMimeType });
      logAction(req, file.id, req.user!.id, "upload", `Uploaded ${file.originalName}`);
      res.status(201).json({ file });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  static async downloadFile(req: Request, res: Response): Promise<void> {
    try {
      const result = await fileService.downloadFile(req.params.fileId, req.user!.id);
      logAction(req, result.file.id, req.user!.id, "download", `Downloaded ${result.file.originalName}`);

      if (result.sha256) {
        res.setHeader("X-Content-Hash", result.sha256);
      }

      if (result.kind === "signed") {
        // Return a JSON body so the client can download directly from S3 using
        // the short-lived URL. The URL expires in 15 minutes — it cannot be
        // shared to bypass RBAC because it will have expired by the time RBAC
        // would matter.
        res.status(200).json({ url: result.url, sha256: result.sha256 ?? null });
      } else {
        const safeFilename = sanitizeFilename(result.file.originalName);
        res.setHeader("Content-Disposition", `attachment; filename="${safeFilename}"`);
        res.setHeader("Content-Type", result.file.mimeType);
        result.stream.pipe(res);
      }
    } catch (error: any) {
      const status =
        error.message === "Access denied." ? 403
        : error.message.includes("not found") ? 404
        : 500;
      res.status(status).json({ message: error.message });
    }
  }

  static async previewFile(req: Request, res: Response): Promise<void> {
    try {
      const { stream, originalName, mimeType, size, sha256 } =
        await fileService.streamFileDownload(req.params.fileId, req.user!.id);

      logViewAction(req, req.params.fileId, req.user!.id);
      const safeFilename = sanitizeFilename(originalName);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(safeFilename)}"`);
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Length", size);
      if (sha256) res.setHeader("X-Content-Hash", sha256);
      stream.pipe(res);
    } catch (error: any) {
      const status =
        error.message === "Access denied." ? 403
        : error.message.includes("not found") ? 404
        : 500;
      res.status(status).json({ message: error.message });
    }
  }

  static async deleteFile(req: Request, res: Response): Promise<void> {
    try {
      const file = await fileService.deleteFile(req.params.fileId, req.user!.id);
      logAction(req, file.id, req.user!.id, "delete", `Deleted ${file.originalName}`);
      res.status(200).json({ message: "File deleted." });
    } catch (error: any) {
      const status =
        error.message === "Access denied." ? 403
        : error.message.includes("not found") ? 404
        : 500;
      res.status(status).json({ message: error.message });
    }
  }

  static async viewFile(req: Request, res: Response): Promise<void> {
    try {
      const { file, role } = await fileService.getFileDetails(req.params.fileId, req.user!.id);
      logViewAction(req, file.id, req.user!.id);
      res.status(200).json({ file, role });
    } catch (error: any) {
      const status =
        error.message === "Access denied." ? 403
        : error.message.includes("not found") ? 404
        : 500;
      res.status(status).json({ message: error.message });
    }
  }

  static async updateAdminOnlyChat(req: Request, res: Response): Promise<void> {
    try {
      const { adminOnlyChat } = req.body;
      if (typeof adminOnlyChat !== "boolean") {
        res.status(400).json({ message: "adminOnlyChat must be a boolean." });
        return;
      }
      const file = await fileService.setAdminOnlyChat(req.params.fileId, req.user!.id, adminOnlyChat);
      res.status(200).json({ adminOnlyChat: file.adminOnlyChat });
    } catch (error: any) {
      const status = error.message === "Access denied." ? 403 : error.message.includes("not found") ? 404 : 500;
      res.status(status).json({ message: error.message });
    }
  }
}
