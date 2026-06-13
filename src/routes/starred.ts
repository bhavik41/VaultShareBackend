import { Router } from "express"
import { authenticate } from "../middleware/auth"
import { AuditLogModel } from "../models/AuditLog"
import { UserModel } from "../models/User"

const router = Router()

/**
 * GET /api/starred/audit
 * Returns the file star events across the authenticated user's activity.
 */
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
