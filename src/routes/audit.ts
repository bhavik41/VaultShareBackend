import { Router } from "express"
import { AuditController } from "../controllers/audit.controller"
import { authenticate } from "../middleware/auth"

const router = Router({ mergeParams: true })

// GET /api/files/:fileId/audit  â€” file-level audit history (owner only)
router.get("/", authenticate, AuditController.getAuditHistory)

export default router

// Separate top-level activity router exported for /api/audit/my-activity
export const activityRouter = Router()
activityRouter.get("/my-activity", authenticate, AuditController.getMyActivity)


// GET /api/audit/stats â€” returns total event counts for dashboard widget
// activityRouter.get("/stats", authenticate, AuditController.getStats)
// Returns: { totalEvents, todayEvents, topAction }

