import { Request, Response } from "express";
import * as fileService from "../services/file.service";
import { logAction } from "../utils/auditLogger";

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
      const { file } = await fileService.uploadFile(req.user!.id, req.file);
      logAction(req, file.id, req.user!.id, "upload", `Uploaded ${file.originalName}`);
      res.status(201).json({ file });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  static async downloadFile(req: Request, res: Response): Promise<void> {
    try {
      const { stream, file } = await fileService.downloadFile(
        req.params.fileId,
        req.user!.id,
      );
      logAction(req, file.id, req.user!.id, "download", `Downloaded ${file.originalName}`);
      res.setHeader("Content-Disposition", `attachment; filename="${file.originalName}"`);
      res.setHeader("Content-Type", file.mimeType);
      stream.pipe(res);
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
      const { stream, originalName, mimeType, size } =
        await fileService.streamFileDownload(req.params.fileId, req.user!.id);

      logAction(req, req.params.fileId, req.user!.id, "view", `Previewed ${originalName}`);
      res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(originalName)}"`);
      res.setHeader("Content-Type", mimeType);
      res.setHeader("Content-Length", size);
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
      const file = await fileService.getFileDetails(req.params.fileId, req.user!.id);
      logAction(req, file.id, req.user!.id, "view", `Viewed ${file.originalName}`);
      res.status(200).json({ file });
    } catch (error: any) {
      const status =
        error.message === "Access denied." ? 403
        : error.message.includes("not found") ? 404
        : 500;
      res.status(status).json({ message: error.message });
    }
  }
}
