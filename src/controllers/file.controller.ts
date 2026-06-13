import { Request, Response } from "express"
import * as fileService from "../services/file.service"
import { logAction } from "../utils/auditLogger"

export class FileController {
  static async uploadFile(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id
      const file = await fileService.uploadFile(userId, req.file!)
      // Audit: record upload event with request metadata
      logAction(req, file.id, userId, "upload", `Uploaded ${file.originalName}`)
      res.status(201).json(file)
    } catch (error: any) {
      res.status(500).json({ message: error.message })
    }
  }

  static async downloadFile(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id
      const { fileId } = req.params
      const { stream, file } = await fileService.downloadFile(fileId, userId)
      // Audit: record download event
      logAction(req, fileId, userId, "download", `Downloaded ${file.originalName}`)
      res.setHeader("Content-Disposition", `attachment; filename="${file.originalName}"`)
      res.setHeader("Content-Type", file.mimeType)
      stream.pipe(res)
    } catch (error: any) {
      const status = error.message === "Access denied." ? 403 : error.message === "File not found." ? 404 : 500
      res.status(status).json({ message: error.message })
    }
  }

  static async deleteFile(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id
      const { fileId } = req.params
      const file = await fileService.deleteFile(fileId, userId)
      // Audit: record delete event before file is gone
      logAction(req, fileId, userId, "delete", `Deleted ${file.originalName}`)
      res.status(200).json({ message: "File deleted." })
    } catch (error: any) {
      const status = error.message === "Access denied." ? 403 : error.message === "File not found." ? 404 : 500
      res.status(status).json({ message: error.message })
    }
  }

  static async viewFile(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id
      const { fileId } = req.params
      const file = await fileService.getFileDetails(fileId, userId)
      // Audit: track file views for access history
      logAction(req, fileId, userId, "view", `Viewed ${file.originalName}`)
      res.status(200).json(file)
    } catch (error: any) {
      const status = error.message === "Access denied." ? 403 : error.message === "File not found." ? 404 : 500
      res.status(status).json({ message: error.message })
    }
  }
}
