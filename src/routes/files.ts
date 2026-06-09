import { Router } from "express";
import { FileController } from "../controllers/file.controller";
import { authenticate } from "../middleware/auth";
import { upload } from "../middleware/upload";
import { requirePermission } from "../middleware/permissions";

const router = Router();

router.use(authenticate);

router.post("/upload", upload.single("file"), FileController.upload);

router.get("/", FileController.list);

router.get(
  "/:id/download",
  requirePermission("view"),
  FileController.download,
);

router.get(
  "/:id/signed-url",
  requirePermission("view"),
  FileController.signedUrl,
);

router.delete(
  "/:id",
  requirePermission("owner"),
  FileController.delete,
);

export default router;