import { Router } from "express"
import { authenticate } from "../middleware/auth"
import { AuditLogModel } from "../models/AuditLog"
import { StarredModel } from "../models/Starred"
import { createAuditLog } from "../db/auditStore"
import { v4 as uuidv4 } from "uuid"

const router = Router()

// GET /api/starred — list starred file IDs for the authenticated user
router.get("/", authenticate, async (req, res) => {
  try {
    const userId = (req as any).user!.id
    const rows = await StarredModel.find({ userId }).lean()
    res.json({ fileIds: rows.map((r) => r.fileId) })
  } catch (err: any) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/starred/:fileId — star a file
router.post("/:fileId", authenticate, async (req, res) => {
  try {
    const userId = (req as any).user!.id
    const { fileId } = req.params
    await StarredModel.findOneAndUpdate(
      { userId, fileId },
      { $setOnInsert: { _id: uuidv4(), userId, fileId } },
      { upsert: true, new: true }
    )
    createAuditLog(fileId, userId, "star").catch(() => {})
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ message: err.message })
  }
})

// DELETE /api/starred/:fileId — unstar a file
router.delete("/:fileId", authenticate, async (req, res) => {
  try {
    const userId = (req as any).user!.id
    const { fileId } = req.params
    await StarredModel.deleteOne({ userId, fileId })
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ message: err.message })
  }
})

// GET /api/starred/audit — star audit log for the authenticated user
router.get("/audit", authenticate, async (req, res) => {
  try {
    const userId = (req as any).user!.id
    const logs = await AuditLogModel.find({ userId, action: "star" })
      .sort({ timestamp: -1 })
      .limit(50)
      .lean()
    res.json({ logs })
  } catch (err: any) {
    res.status(500).json({ message: err.message })
  }
})

export default router
