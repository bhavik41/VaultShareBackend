import { Router } from "express";
import { AuditController } from "../controllers/audit.controller";
import { authenticate } from "../middleware/auth";

const router = Router({ mergeParams: true });

// Get audit history for a specific file
// Route will be mounted at /api/files/:fileId/audit
router.get("/", authenticate, AuditController.getAuditHistory);

export default router;
