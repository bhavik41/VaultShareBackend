import multer from "multer";
import path from "path";
import fs from "fs";
import type { Request } from "express";
import { v4 as uuidv4 } from "uuid";

const ALLOWED_MIME_TYPES = new Set([
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
  "image/svg+xml",
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
  "application/octet-stream",
  "application/x-photoshop",
  "image/vnd.adobe.photoshop",
  "application/json",
  "application/xml",
  "text/xml",
  "text/html",
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
