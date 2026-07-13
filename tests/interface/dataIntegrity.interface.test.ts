/**
 * Interface Testing — Data Integrity & Headers
 * Verifies exact response shapes, HTTP status codes, and required headers
 * for file upload/download/preview endpoints.
 */
import request from "supertest";
import jwt from "jsonwebtoken";
import { Readable } from "stream";

jest.mock("../../src/middleware/rateLimiter", () => ({
  signinLimiter: (_: any, __: any, n: any) => n(),
  signupLimiter: (_: any, __: any, n: any) => n(),
  forgotPasswordLimiter: (_: any, __: any, n: any) => n(),
  twoFaLimiter: (_: any, __: any, n: any) => n(),
  refreshLimiter: (_: any, __: any, n: any) => n(),
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
  deleteVersionsByFile: jest.fn(),
  setActiveVersion: jest.fn(),
}));
jest.mock("../../src/services/s3.service", () => ({
  buildVersionKey: jest.fn().mockReturnValue("uploads/u1/f1/v1.pdf"),
  putObject: jest.fn().mockResolvedValue(undefined),
  getPresignedDownloadUrl: jest.fn().mockResolvedValue("https://s3.example.com/f1?sig=x"),
  getObjectStream: jest.fn(),
  deleteObject: jest.fn(),
}));
jest.mock("../../src/utils/accessControl", () => ({
  requireFileAccess: jest.fn(),
  getFilePermission: jest.fn(),
}));
jest.mock("../../src/utils/auditLogger", () => ({ logAction: jest.fn(), logViewAction: jest.fn() }));
jest.mock("../../src/middleware/virusScan", () => ({ virusScan: (_: any, __: any, n: any) => n() }));
jest.mock("../../src/middleware/permissions", () => ({ requirePermission: () => (_: any, __: any, n: any) => n() }));
jest.mock("../../src/middleware/uploadThrottle", () => ({ uploadThrottle: (_: any, __: any, n: any) => n() }));

import app from "../../src/app";
import * as fileStore from "../../src/db/fileStore";
import * as versionStore from "../../src/db/fileVersionStore";
import * as s3 from "../../src/services/s3.service";
import * as accessControl from "../../src/utils/accessControl";
import type { StoredFile } from "../../src/db/fileStore";
import type { StoredFileVersion } from "../../src/db/fileVersionStore";

const mockCreateFile = jest.mocked(fileStore.createFile);
const mockGetActive = jest.mocked(versionStore.getActiveVersion);
const mockCreateVersion = jest.mocked(versionStore.createFileVersion);
const mockSetActive = jest.mocked(versionStore.setActiveVersion);
const mockRequireAccess = jest.mocked(accessControl.requireFileAccess);
const mockGetObjectStream = jest.mocked(s3.getObjectStream);

function authHeader(): string {
  return `Bearer ${jwt.sign(
    { id: "u1", email: "alice@example.com", name: "Alice", twoFactorEnabled: false },
    process.env.JWT_SECRET!, { algorithm: "HS256", expiresIn: "1h" },
  )}`;
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
    sha256: "deadbeef1234deadbeef1234deadbeef1234deadbeef1234deadbeef12341234",
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

// ─── Upload response shape ────────────────────────────────────────────────────

describe("Interface — POST /api/files/upload response shape", () => {
  it("201 body has { file: object } with file metadata", async () => {
    const res = await request(app)
      .post("/api/files/upload")
      .set("Authorization", authHeader())
      .attach("file", Buffer.from("%PDF-1.7 test"), "doc.pdf");

    expect(res.status).toBe(201);
    expect(res.body.file).toBeDefined();
    expect(res.body.file.id).toBeDefined();
  });

  it("400 body has { message: string } when no file attached", async () => {
    const res = await request(app)
      .post("/api/files/upload")
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    expect(typeof res.body.message).toBe("string");
  });

  it("400 body has { message: 'Invalid originalMimeType.' } for unknown MIME type", async () => {
    const res = await request(app)
      .post("/api/files/upload")
      .set("Authorization", authHeader())
      .attach("file", Buffer.from("%PDF-1.7 test"), "doc.pdf")
      .field("originalMimeType", "application/x-hack");

    expect(res.status).toBe(400);
    expect(res.body.message).toBe("Invalid originalMimeType.");
  });
});

// ─── Download response shape — signed ─────────────────────────────────────────

describe("Interface — GET /api/files/:fileId/download response shape (signed)", () => {
  it("200 body has { url: string, sha256: string | null }", async () => {
    const sha256 = "deadbeef1234deadbeef1234deadbeef1234deadbeef1234deadbeef12341234";
    mockRequireAccess.mockResolvedValue({ file: storedFile(), role: "owner" });
    mockGetActive.mockResolvedValue(storedVersion({ sha256 }));

    const res = await request(app)
      .get("/api/files/f1/download")
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(typeof res.body.url).toBe("string");
    expect(res.body.sha256).toBe(sha256);
    expect(typeof res.body.sha256).toBe("string");
  });

  it("X-Content-Hash header is a 64-char hex string when sha256 is present", async () => {
    const sha256 = "cafebabe0000cafebabe0000cafebabe0000cafebabe0000cafebabe00001234";
    mockRequireAccess.mockResolvedValue({ file: storedFile(), role: "owner" });
    mockGetActive.mockResolvedValue(storedVersion({ sha256 }));

    const res = await request(app)
      .get("/api/files/f1/download")
      .set("Authorization", authHeader());

    const header = res.headers["x-content-hash"];
    expect(header).toMatch(/^[0-9a-f]{64}$/);
  });

  it("sha256 is null in body when version has no hash (legacy file)", async () => {
    mockRequireAccess.mockResolvedValue({ file: storedFile(), role: "owner" });
    mockGetActive.mockResolvedValue(storedVersion({ sha256: undefined }));

    const res = await request(app)
      .get("/api/files/f1/download")
      .set("Authorization", authHeader());

    expect(res.body.sha256).toBeNull();
    expect(res.headers["x-content-hash"]).toBeUndefined();
  });

  it("Content-Type is application/json for signed download", async () => {
    mockRequireAccess.mockResolvedValue({ file: storedFile(), role: "owner" });
    mockGetActive.mockResolvedValue(storedVersion());

    const res = await request(app)
      .get("/api/files/f1/download")
      .set("Authorization", authHeader());

    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

// ─── Security headers shape ───────────────────────────────────────────────────

describe("Interface — Security headers contract", () => {
  it("Strict-Transport-Security header includes max-age and includeSubDomains", async () => {
    const res = await request(app).get("/api/auth/me");
    const hsts = res.headers["strict-transport-security"];
    expect(hsts).toMatch(/max-age=31536000/);
    expect(hsts).toMatch(/includeSubDomains/i);
  });

  it("X-Frame-Options is exactly DENY", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.headers["x-frame-options"]).toBe("DENY");
  });

  it("X-Content-Type-Options is exactly nosniff", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("Content-Security-Policy contains default-src 'self'", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.headers["content-security-policy"]).toMatch(/default-src 'self'/);
  });

  it("Referrer-Policy is strict-origin-when-cross-origin", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  });
});
