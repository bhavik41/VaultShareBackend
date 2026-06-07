import { Router } from "express";
import { FileController } from "../controllers/file.controller";
import { authenticate } from "../middleware/auth";
import { upload } from "../middleware/upload";

const router = Router();

// All file routes require a valid JWT
router.use(authenticate);

// POST /api/files/upload
// multipart/form-data with a "file" field — uploads to GCS
router.post("/upload", upload.single("file"), FileController.upload);

// GET /api/files
// List all files for the authenticated user
router.get("/", FileController.list);

// GET /api/files/:id/download
// Streams the file directly from GCS → browser (triggers Save As dialog)
router.get("/:id/download", FileController.download);

// GET /api/files/:id/signed-url
// Returns a short-lived (1 hr) GCS signed URL for preview / sharing
router.get("/:id/signed-url", FileController.signedUrl);

// DELETE /api/files/:id
// Deletes the file from GCS and removes its metadata record
router.delete("/:id", FileController.delete);

export default router;
