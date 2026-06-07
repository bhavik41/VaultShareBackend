import multer from "multer";
import type { Request } from "express";

// ── Allowed MIME types ────────────────────────────────────────────────────────
// Add or remove entries here to control what file types are accepted.
const ALLOWED_MIME_TYPES = new Set([
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
  // Images
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  // Video
  "video/mp4",
  "video/webm",
  "video/quicktime",
  // Audio
  "audio/mpeg",
  "audio/wav",
  "audio/ogg",
  // Archives
  "application/zip",
  "application/x-zip-compressed",
  "application/x-rar-compressed",
  "application/x-tar",
  "application/gzip",
  "application/x-7z-compressed",
  // Design / dev
  "application/octet-stream", // .fig, .sketch, .psd, binary blobs
  "application/x-photoshop",
  "image/vnd.adobe.photoshop",
  // Code / data
  "application/json",
  "application/xml",
  "text/xml",
  "text/html",
]);

// Max file size: default 50 MB, overridable via MAX_FILE_SIZE_MB env var
const MAX_MB = parseInt(process.env.MAX_FILE_SIZE_MB ?? "50", 10);

// Store file in memory — we forward the buffer directly to GCS
const storage = multer.memoryStorage();

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
        `File type "${file.mimetype}" is not allowed. ` +
          `Accepted types: PDF, Word, Excel, PowerPoint, images, video, audio, ZIP, and common dev formats.`,
      ),
    );
  }
}

export const upload = multer({
  storage,
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter,
});
