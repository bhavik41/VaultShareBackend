import multer from "multer";
import path from "path";
import fs from "fs";
import type { Request, Response, NextFunction } from "express";
import { v4 as uuidv4 } from "uuid";

// #31 — text/html removed (executes in browser)
// #32 — image/svg+xml removed from allowlist (SVG can embed JS); serve separately as attachment only
// #33 — application/octet-stream removed (catch-all that bypasses the allowlist)
// application/vaultshare-encrypted is the internal sentinel for client-side AES-GCM encrypted uploads
const ALLOWED_MIME_TYPES = new Set([
  "application/vaultshare-encrypted",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  "application/zip",
  "application/x-zip-compressed",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-7z-compressed",
  "application/x-photoshop",
  "image/vnd.adobe.photoshop",
  "application/json",
  "application/xml",
  "text/xml",
]);

// #30 — Magic byte signatures for content-based validation
// Each entry: [mimeType, offset, magic bytes as hex string]
const MAGIC_BYTES: Array<{ mime: string; offset: number; hex: string }> = [
  { mime: "application/pdf", offset: 0, hex: "255044462d" },               // %PDF-
  { mime: "image/jpeg", offset: 0, hex: "ffd8ff" },                         // JPEG
  { mime: "image/png", offset: 0, hex: "89504e470d0a1a0a" },               // PNG
  { mime: "image/gif", offset: 0, hex: "474946383761" },                    // GIF87a
  { mime: "image/gif", offset: 0, hex: "474946383961" },                    // GIF89a
  { mime: "image/webp", offset: 0, hex: "52494646" },                       // RIFF (WEBP)
  { mime: "application/zip", offset: 0, hex: "504b0304" },                  // PK.. (ZIP)
  { mime: "application/x-zip-compressed", offset: 0, hex: "504b0304" },
  { mime: "application/gzip", offset: 0, hex: "1f8b" },                     // GZIP
  { mime: "application/x-7z-compressed", offset: 0, hex: "377abcaf271c" }, // 7-Zip
  { mime: "video/mp4", offset: 4, hex: "66747970" },                        // ftyp
  { mime: "audio/mpeg", offset: 0, hex: "494433" },                         // ID3
  { mime: "audio/wav", offset: 0, hex: "52494646" },                        // RIFF (WAV)
  { mime: "application/msword", offset: 0, hex: "d0cf11e0a1b11ae1" },       // OLE2 (old .doc/.xls/.ppt)
  { mime: "application/vnd.ms-excel", offset: 0, hex: "d0cf11e0a1b11ae1" },
  { mime: "application/vnd.ms-powerpoint", offset: 0, hex: "d0cf11e0a1b11ae1" },
  // Modern Office formats are ZIP-based
  { mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", offset: 0, hex: "504b0304" },
  { mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", offset: 0, hex: "504b0304" },
  { mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", offset: 0, hex: "504b0304" },
];

// MIME types that are text-based and cannot be validated by magic bytes
const TEXT_BASED_MIMES = new Set([
  "text/plain",
  "text/csv",
  "application/json",
  "application/xml",
  "text/xml",
]);

const MAX_MB = parseInt(process.env.MAX_FILE_SIZE_MB ?? "50", 10);

const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  },
});

function fileFilter(
  _req: Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback,
) {
  if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `File type "${file.mimetype}" is not allowed. Accepted types: PDF, Word, Excel, PowerPoint, images, video, audio, ZIP, and common dev formats.`,
      ),
    );
  }
}

export const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter,
});

/**
 * #30 — Magic byte validation middleware.
 * Must run AFTER multer has written the file to disk.
 * Reads the first 16 bytes of the uploaded file and compares against
 * known magic byte signatures. Text-based formats (JSON, CSV, etc.) are
 * skipped since they have no reliable binary signature.
 */
export function validateMagicBytes(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const file = req.file;
  if (!file) {
    next();
    return;
  }

  // Text-based formats and client-encrypted uploads: skip magic byte check
  if (TEXT_BASED_MIMES.has(file.mimetype) || file.mimetype === "application/vaultshare-encrypted") {
    next();
    return;
  }

  try {
    const fd = fs.openSync(file.path, "r");
    const buf = Buffer.alloc(16);
    fs.readSync(fd, buf, 0, 16, 0);
    fs.closeSync(fd);

    const fileHex = buf.toString("hex");

    const signatures = MAGIC_BYTES.filter((m) => m.mime === file.mimetype);
    if (signatures.length === 0) {
      // No known signature for this mime — allow through (conservative)
      next();
      return;
    }

    const valid = signatures.some((sig) => {
      const slice = buf.slice(sig.offset, sig.offset + sig.hex.length / 2).toString("hex");
      return slice.startsWith(sig.hex);
    });

    if (!valid) {
      // Delete the suspect file from disk
      fs.unlink(file.path, () => {});
      res.status(400).json({
        message: `File content does not match declared type "${file.mimetype}". Upload rejected.`,
      });
      return;
    }

    next();
  } catch (err: any) {
    // Delete on read failure to be safe
    if (file.path) fs.unlink(file.path, () => {});
    res.status(500).json({ message: "Failed to validate file content." });
  }
}
