import { Router } from "express"
import { AuditController } from "../controllers/audit.controller"
import { authenticate } from "../middleware/auth"

const router = Router({ mergeParams: true })

// GET /api/files/:fileId/audit â€” file-level audit history (owner only)
router.get("/", authenticate, AuditController.getAuditHistory)

// GET /api/files/:fileId/audit/range?from=&to= â€” date-range filter (owner only)
router.get("/range", authenticate, AuditController.getAuditHistoryByDateRange)

export default router

// Top-level activity and stats routes
export const activityRouter = Router()
activityRouter.get("/my-activity", authenticate, AuditController.getMyActivity)
activityRouter.get("/stats", authenticate, AuditController.getStats)
