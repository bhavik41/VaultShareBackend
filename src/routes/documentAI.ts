import { Router, Request, Response } from "express";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { askQuestion } from "../services/documentAI.service";

const router = Router({ mergeParams: true });

router.use(authenticate);

/**
 * POST /api/files/:fileId/ask
 * Body: { question: string }
 * Returns: { answer, chunksUsed, totalChunks }
 */
router.post(
  "/",
  requirePermission("view"),
  async (req: Request, res: Response): Promise<void> => {
    const { fileId } = req.params;
    const { question } = req.body as { question?: string };

    if (!question || question.trim().length === 0) {
      res.status(400).json({ message: "question is required." });
      return;
    }
    if (question.length > 1000) {
      res.status(400).json({ message: "Question must be under 1000 characters." });
      return;
    }

    try {
      const result = await askQuestion(fileId, question.trim());
      res.json(result);
    } catch (err: any) {
const status = err.message.includes("not found") ? 404
        : err.message.includes("not configured") ? 503
        : err.message.includes("Unsupported file type") ? 422
        : 500;
      res.status(status).json({ message: err.message });
    }
  },
);

export default router;
