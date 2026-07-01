import { Router } from "express";
import { VersionController } from "../controllers/version.controller";
import { authenticate } from "../middleware/auth";
import { upload, validateMagicBytes } from "../middleware/upload";
import { uploadThrottle } from "../middleware/uploadThrottle";
import { virusScan } from "../middleware/virusScan";

// Mounted at /api/files/:fileId/versions — mergeParams gives access to :fileId.
const router = Router({ mergeParams: true });

router.use(authenticate);

router.get("/", VersionController.listVersions);

router.post(
  "/",
  uploadThrottle,
  upload.single("file"),
  validateMagicBytes,
  virusScan,
  VersionController.uploadVersion,
);

router.post(
  "/request",
  uploadThrottle,
  upload.single("file"),
  validateMagicBytes,
  virusScan,
  VersionController.requestVersion,
);

router.get("/requests", VersionController.listPendingRequests);
router.post("/requests/:requestId/approve", VersionController.approveRequest);
router.post("/requests/:requestId/reject", VersionController.rejectRequest);

router.patch("/:versionId/activate", VersionController.activateVersion);
router.get("/:versionId/download", VersionController.downloadVersion);
router.delete("/:versionId", VersionController.deleteVersion);

export default router;

// Top-level admin approval queue: pending version requests across every
// file the authenticated user owns. Mounted at /api/version-requests.
export const versionRequestsRouter = Router();
versionRequestsRouter.get(
  "/",
  authenticate,
  VersionController.listPendingRequestsForOwner,
);
