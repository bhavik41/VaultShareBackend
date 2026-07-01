import { Router } from "express";
import { FileController } from "../controllers/file.controller";
import { VersionController } from "../controllers/version.controller";
import { authenticate } from "../middleware/auth";
import { upload, validateMagicBytes } from "../middleware/upload";
import { requirePermission } from "../middleware/permissions";
import { uploadThrottle } from "../middleware/uploadThrottle";
import { virusScan } from "../middleware/virusScan";

const router = Router();

router.use(authenticate);

router.post("/upload", uploadThrottle, upload.single("file"), validateMagicBytes, virusScan, FileController.uploadFile);

router.get("/", FileController.listFiles);

router.get(
  "/:fileId/download",
  requirePermission("download"),
  FileController.downloadFile,
);

router.get(
  "/:fileId/preview",
  requirePermission("view"),
  FileController.previewFile,
);

router.get(
  "/:fileId/view",
  requirePermission("view"),
  FileController.viewFile,
);

router.delete(
  "/:fileId",
  requirePermission("owner"),
  FileController.deleteFile,
);

router.patch(
  "/:fileId/version-policy",
  requirePermission("owner"),
  VersionController.updatePolicy,
);

export default router;
