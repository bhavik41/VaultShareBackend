import { Router, Request, Response } from "express";
import { promisify } from "util";
import { authenticate } from "../middleware/auth";
import { requirePermission } from "../middleware/permissions";
import { getActiveVersion } from "../db/fileVersionStore";
import { getObjectStream } from "../services/s3.service";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const libre = require("libreoffice-convert");
const convertAsync = promisify(libre.convert) as (buf: Buffer, ext: string, filter: string | undefined) => Promise<Buffer>;

const PPTX_MIMES = new Set([
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.ms-powerpoint",
]);

const router = Router({ mergeParams: true });
router.use(authenticate);

router.get(
  "/",
  requirePermission("view"),
  async (req: Request, res: Response): Promise<void> => {
    const { fileId } = req.params;

    const version = await getActiveVersion(fileId);
    if (!version) {
      res.status(404).json({ message: "File version not found." });
      return;
    }

    if (!PPTX_MIMES.has(version.mimeType)) {
      res.status(422).json({ message: "Only PPTX files can be converted to PDF preview." });
      return;
    }

    // Stream PPTX from S3 into a buffer
    const stream = await getObjectStream(version.s3Key);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const pptxBuf = Buffer.concat(chunks);

    // Convert to PDF using LibreOffice (headless)
    const pdfBuf = await convertAsync(pptxBuf, ".pdf", undefined);

    res.set({
      "Content-Type": "application/pdf",
      "Content-Length": pdfBuf.length,
      "Cache-Control": "private, max-age=300",
    });
    res.send(pdfBuf);
  },
);

export default router;
