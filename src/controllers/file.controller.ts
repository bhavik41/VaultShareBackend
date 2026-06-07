import { Request, Response } from "express";
import multer from "multer";
import * as fileService from "../services/file.service";

// Extend Express Request with multer's file property
interface MulterRequest extends Request {
  file?: Express.Multer.File;
}

export class FileController {
  /**
   * POST /api/files/upload
   * Accepts multipart/form-data with a "file" field.
   * Requires authentication (req.user set by authenticate middleware).
   * Multer validates file type and size before this runs.
   */
  static async upload(req: MulterRequest, res: Response): Promise<void> {
    try {
      const multerFile = req.file;
      if (!multerFile) {
        res
          .status(400)
          .json({ message: "No file provided. Send a 'file' field." });
        return;
      }

      const { originalname, mimetype, buffer, size } = multerFile;
      const userId = req.user!.id;

      const { file } = await fileService.uploadFile(
        userId,
        originalname,
        mimetype,
        buffer,
        size,
      );

      res.status(201).json({
        message: "File uploaded successfully.",
        file: {
          id: file.id,
          name: file.originalName,
          mimeType: file.mimeType,
          size: file.size,
          url: file.publicUrl,
          createdAt: file.createdAt,
        },
      });
    } catch (err: any) {
      // Multer file size error
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        const maxMb = parseInt(process.env.MAX_FILE_SIZE_MB ?? "50", 10);
        res.status(413).json({
          message: `File too large. Maximum allowed size is ${maxMb} MB.`,
        });
        return;
      }
      // Multer file type error (thrown by fileFilter)
      if (err?.message?.startsWith("File type")) {
        res.status(415).json({ message: err.message });
        return;
      }
      const status = err.message?.includes("not configured") ? 500 : 400;
      res.status(status).json({ message: err.message });
    }
  }

  /**
   * GET /api/files
   * Returns all files belonging to the authenticated user.
   */
  static list(req: Request, res: Response): void {
    try {
      const userId = req.user!.id;
      const files = fileService.listFiles(userId);

      res.status(200).json({
        files: files.map((f) => ({
          id: f.id,
          name: f.originalName,
          mimeType: f.mimeType,
          size: f.size,
          url: f.publicUrl,
          createdAt: f.createdAt,
        })),
      });
    } catch (err: any) {
      res.status(500).json({ message: err.message });
    }
  }

  /**
   * GET /api/files/:id/download
   * Streams the file directly from GCS through the backend to the client.
   * Sets Content-Disposition: attachment so the browser triggers a file save.
   */
  static async download(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.id;

      const { stream, originalName, mimeType, size } =
        await fileService.streamFileDownload(id, userId);

      // Tell the browser to save the file with its original name
      res.setHeader("Content-Type", mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${encodeURIComponent(originalName)}"`,
      );
      res.setHeader("Content-Length", size);
      res.setHeader("Cache-Control", "private, no-cache");

      // Pipe GCS read stream → HTTP response
      stream.on("error", (err) => {
        // Stream already started — cannot change status code, just end it
        console.error("[download] GCS stream error:", err);
        res.end();
      });

      stream.pipe(res);
    } catch (err: any) {
      const status =
        err.message === "File not found."
          ? 404
          : err.message === "Access denied."
            ? 403
            : err.message === "File no longer exists in storage."
              ? 410
              : 500;
      res.status(status).json({ message: err.message });
    }
  }

  /**
   * GET /api/files/:id/signed-url
   * Returns a short-lived (1 hour) GCS signed URL.
   * Useful for in-browser preview or sharing a link.
   */
  static async signedUrl(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      const url = await fileService.getSignedUrl(id, userId);
      res.status(200).json({ url, expiresIn: 3600 });
    } catch (err: any) {
      const status =
        err.message === "File not found."
          ? 404
          : err.message === "Access denied."
            ? 403
            : 500;
      res.status(status).json({ message: err.message });
    }
  }

  /**
   * DELETE /api/files/:id
   * Removes the file from GCS and clears the metadata record.
   */
  static async delete(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = req.user!.id;
      await fileService.deleteFile(id, userId);
      res.status(200).json({ message: "File deleted." });
    } catch (err: any) {
      const status =
        err.message === "File not found."
          ? 404
          : err.message === "Access denied."
            ? 403
            : 500;
      res.status(status).json({ message: err.message });
    }
  }
}
