/**
 * E2E — Data Integrity & Headers
 * Full HTTP stack via supertest for file upload/download endpoints.
 * DB and S3 layers are mocked; middleware runs for real.
 */
import request from "supertest";
import jwt from "jsonwebtoken";
import { Readable } from "stream";

jest.mock("../../src/middleware/rateLimiter", () => ({
  signinLimiter: (_: any, __: any, next: any) => next(),
  signupLimiter: (_: any, __: any, next: any) => next(),
  forgotPasswordLimiter: (_: any, __: any, next: any) => next(),
  twoFaLimiter: (_: any, __: any, next: any) => next(),
  refreshLimiter: (_: any, __: any, next: any) => next(),
}));

jest.mock("../../src/db/fileStore", () => ({
  getFilesByUser: jest.fn().mockResolvedValue([]),
  createFile: jest.fn(),
  getFileById: jest.fn(),
  deleteFile: jest.fn(),
  setAdminOnlyChat: jest.fn(),
}));
jest.mock("../../src/db/fileVersionStore", () => ({
  createFileVersion: jest.fn(),
  getActiveVersion: jest.fn(),
  getVersionsByFile: jest.fn().mockResolvedValue([]),
  deleteVersionsByFile: jest.fn().mockResolvedValue(undefined),
  setActiveVersion: jest.fn(),
}));
jest.mock("../../src/services/s3.service", () => ({
  buildVersionKey: jest.fn().mockReturnValue("uploads/u1/f1/v1.pdf"),
  putObject: jest.fn().mockResolvedValue(undefined),
  getPresignedDownloadUrl: jest.fn().mockResolvedValue("https://s3.example.com/f1?sig=abc"),
  getObjectStream: jest.fn(),
  deleteObject: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../src/utils/accessControl", () => ({
  requireFileAccess: jest.fn(),
  requirePermission: jest.fn(() => (_: any, __: any, next: any) => next()),
  getFilePermission: jest.fn(),
}));
jest.mock("../../src/utils/auditLogger", () => ({
  logAction: jest.fn(),
  logViewAction: jest.fn(),
}));
jest.mock("../../src/middleware/virusScan", () => ({
  virusScan: (_: any, __: any, next: any) => next(),
}));
jest.mock("../../src/middleware/permissions", () => ({
  requirePermission: () => (_: any, __: any, next: any) => next(),
}));
jest.mock("../../src/middleware/uploadThrottle", () => ({
  uploadThrottle: (_: any, __: any, next: any) => next(),
}));

import app from "../../src/app";
import * as fileStore from "../../src/db/fileStore";
import * as versionStore from "../../src/db/fileVersionStore";
import * as s3 from "../../src/services/s3.service";
import * as accessControl from "../../src/utils/accessControl";
import type { StoredFile } from "../../src/db/fileStore";
import type { StoredFileVersion } from "../../src/db/fileVersionStore";

const mockCreateFile = jest.mocked(fileStore.createFile);
const mockGetFileById = jest.mocked(fileStore.getFileById);
const mockCreateVersion = jest.mocked(versionStore.createFileVersion);
const mockSetActive = jest.mocked(versionStore.setActiveVersion);
const mockGetActive = jest.mocked(versionStore.getActiveVersion);
const mockGetPresigned = jest.mocked(s3.getPresignedDownloadUrl);
const mockRequireAccess = jest.mocked(accessControl.requireFileAccess);

function authHeader(): string {
  const token = jwt.sign(
    { id: "u1", email: "alice@example.com", name: "Alice", twoFactorEnabled: false },
    process.env.JWT_SECRET!,
    { algorithm: "HS256", expiresIn: "1h" },
  );
  return `Bearer ${token}`;
}

function storedFile(o: Partial<StoredFile> = {}): StoredFile {
  return {
    id: "f1", name: "doc.pdf", userId: "u1", originalName: "doc.pdf",
    mimeType: "application/pdf", size: 1024, diskPath: "", publicUrl: "/api/files/f1/download",
    adminOnlyChat: false, createdAt: new Date(), isEncrypted: false,
    versionPolicy: "admin_only", activeVersionId: "v1", ...o,
  } as StoredFile;
}

function storedVersion(o: Partial<StoredFileVersion> = {}): StoredFileVersion {
  return {
    id: "v1", fileId: "f1", versionNumber: 1, uploadedBy: "u1",
    s3Key: "uploads/u1/f1/v1.pdf", originalName: "doc.pdf", size: 1024,
    mimeType: "application/pdf", isActive: true, isEncrypted: false,
    sha256: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    createdAt: new Date(), ...o,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(fileStore.getFilesByUser).mockResolvedValue([]);
  mockCreateFile.mockImplementation(async (i) => ({ ...i } as StoredFile));
  mockCreateVersion.mockResolvedValue(storedVersion());
  mockSetActive.mockResolvedValue(storedVersion());
});

// ─── POST /api/files/upload ───────────────────────────────────────────────────

describe("E2E POST /api/files/upload", () => {
  it("201 for a valid PDF upload", async () => {
    const res = await request(app)
      .post("/api/files/upload")
      .set("Authorization", authHeader())
      .attach("file", Buffer.from("%PDF-1.7 test"), "test.pdf")
      .field("Content-Type", "application/pdf");

    expect(res.status).toBe(201);
    expect(res.body.file).toBeDefined();
  });

  it("400 when no file is attached", async () => {
    const res = await request(app)
      .post("/api/files/upload")
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no file/i);
  });

  it("400 for an unknown originalMimeType", async () => {
    const res = await request(app)
      .post("/api/files/upload")
      .set("Authorization", authHeader())
      .attach("file", Buffer.from("%PDF-1.7 test"), "test.pdf")
      .field("originalMimeType", "application/x-evil-script");

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/originalMimeType/i);
  });

  it("401 without auth token", async () => {
    const res = await request(app)
      .post("/api/files/upload")
      .attach("file", Buffer.from("%PDF-1.7 test"), "test.pdf");

    expect(res.status).toBe(401);
  });
});

// ─── GET /api/files/:fileId/download — signed URL ─────────────────────────────

describe("E2E GET /api/files/:fileId/download — signed URL", () => {
  it("200 + {url, sha256} JSON for S3-backed file", async () => {
    const sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    mockRequireAccess.mockResolvedValue({ file: storedFile(), role: "owner" });
    mockGetActive.mockResolvedValue(storedVersion({ sha256 }));

    const res = await request(app)
      .get("/api/files/f1/download")
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body.url).toBe("https://s3.example.com/f1?sig=abc");
    expect(res.body.sha256).toBe(sha256);
  });

  it("sets X-Content-Hash header on the response", async () => {
    const sha256 = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
    mockRequireAccess.mockResolvedValue({ file: storedFile(), role: "owner" });
    mockGetActive.mockResolvedValue(storedVersion({ sha256 }));

    const res = await request(app)
      .get("/api/files/f1/download")
      .set("Authorization", authHeader());

    expect(res.headers["x-content-hash"]).toBe(sha256);
  });

  it("401 without auth token", async () => {
    const res = await request(app).get("/api/files/f1/download");
    expect(res.status).toBe(401);
  });
});

// ─── Security headers on all responses ───────────────────────────────────────

describe("E2E Security headers (helmet)", () => {
  it("X-Frame-Options: DENY is set on file endpoints", async () => {
    jest.mocked(fileStore.getFilesByUser).mockResolvedValue([]);
    const res = await request(app)
      .get("/api/files/")
      .set("Authorization", authHeader());

    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("X-Content-Type-Options: nosniff is set", async () => {
    jest.mocked(fileStore.getFilesByUser).mockResolvedValue([]);
    const res = await request(app)
      .get("/api/files/")
      .set("Authorization", authHeader());

    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("Content-Security-Policy header is present", async () => {
    jest.mocked(fileStore.getFilesByUser).mockResolvedValue([]);
    const res = await request(app)
      .get("/api/files/")
      .set("Authorization", authHeader());

    expect(res.headers["content-security-policy"]).toBeTruthy();
  });
});
