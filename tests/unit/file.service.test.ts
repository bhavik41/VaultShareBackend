import crypto from "crypto";
import fs from "fs";
import { Readable } from "stream";
import type { StoredFile } from "../../src/db/fileStore";
import type { StoredFileVersion } from "../../src/db/fileVersionStore";

jest.mock("../../src/db/fileStore", () => ({
  getFilesByUser: jest.fn(),
  createFile: jest.fn(),
  getFileById: jest.fn(),
  deleteFile: jest.fn(),
  setAdminOnlyChat: jest.fn(),
}));

jest.mock("../../src/db/fileVersionStore", () => ({
  createFileVersion: jest.fn(),
  getActiveVersion: jest.fn(),
  getVersionsByFile: jest.fn(),
  deleteVersionsByFile: jest.fn(),
  setActiveVersion: jest.fn(),
}));

jest.mock("../../src/services/s3.service", () => ({
  buildVersionKey: jest.fn().mockReturnValue("uploads/owner-1/file-1/v1_key.pdf"),
  putObject: jest.fn().mockResolvedValue(undefined),
  getPresignedDownloadUrl: jest.fn(),
  getObjectStream: jest.fn(),
  deleteObject: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/utils/accessControl", () => ({
  requireFileAccess: jest.fn(),
}));

import * as fileStore from "../../src/db/fileStore";
import * as fileVersionStore from "../../src/db/fileVersionStore";
import * as s3Service from "../../src/services/s3.service";
import * as accessControl from "../../src/utils/accessControl";
import * as fileService from "../../src/services/file.service";

const mockGetFilesByUser = jest.mocked(fileStore.getFilesByUser);
const mockCreateFile = jest.mocked(fileStore.createFile);
const mockCreateFileVersion = jest.mocked(fileVersionStore.createFileVersion);
const mockGetActiveVersion = jest.mocked(fileVersionStore.getActiveVersion);
const mockSetActiveVersion = jest.mocked(fileVersionStore.setActiveVersion);
const mockGetPresignedDownloadUrl = jest.mocked(s3Service.getPresignedDownloadUrl);
const mockGetObjectStream = jest.mocked(s3Service.getObjectStream);
const mockRequireFileAccess = jest.mocked(accessControl.requireFileAccess);

function storedFile(overrides: Partial<StoredFile> = {}): StoredFile {
  return {
    id: "file-1",
    name: "report.pdf",
    userId: "owner-1",
    originalName: "report.pdf",
    mimeType: "application/pdf",
    size: 1024,
    diskPath: "",
    publicUrl: "/api/files/file-1/download",
    adminOnlyChat: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    isEncrypted: false,
    versionPolicy: "admin_only",
    activeVersionId: "v1",
    ...overrides,
  } as StoredFile;
}

function storedVersion(overrides: Partial<StoredFileVersion> = {}): StoredFileVersion {
  return {
    id: "v1",
    fileId: "file-1",
    versionNumber: 1,
    uploadedBy: "owner-1",
    s3Key: "uploads/owner-1/file-1/v1_key.pdf",
    originalName: "report.pdf",
    size: 1024,
    mimeType: "application/pdf",
    isActive: true,
    isEncrypted: false,
    sha256: "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function multerFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: "file",
    originalname: "report.pdf",
    encoding: "7bit",
    mimetype: "application/pdf",
    size: 1024,
    buffer: Buffer.from("%PDF-1.7 test content"),
    destination: "",
    filename: "",
    path: "",
    stream: undefined as never,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  mockGetFilesByUser.mockResolvedValue([]);
  mockCreateFile.mockImplementation(async (input) => ({ ...input } as StoredFile));
  mockCreateFileVersion.mockResolvedValue(storedVersion());
  mockSetActiveVersion.mockResolvedValue(storedVersion());
  mockGetPresignedDownloadUrl.mockResolvedValue("https://s3.example.com/file?sig=abc&expires=900");
  mockGetObjectStream.mockResolvedValue(new Readable({ read() {} }));
});

// ─── uploadFile: sha256 ───────────────────────────────────────────────────────

describe("file.service uploadFile — sha256", () => {
  it("computes and stores the correct SHA-256 of the uploaded buffer", async () => {
    const buffer = Buffer.from("%PDF-1.7 test content");
    const expected = crypto.createHash("sha256").update(buffer).digest("hex");

    await fileService.uploadFile("owner-1", multerFile({ buffer }), {});

    expect(mockCreateFileVersion).toHaveBeenCalledWith(
      expect.objectContaining({ sha256: expected }),
    );
  });

  it("sha256 is always a 64-character hex string", async () => {
    await fileService.uploadFile("owner-1", multerFile(), {});

    const { sha256 } = mockCreateFileVersion.mock.calls[0][0];
    expect(typeof sha256).toBe("string");
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("different file contents produce different sha256 values", async () => {
    await fileService.uploadFile("owner-1", multerFile({ buffer: Buffer.from("content A") }), {});
    const sha256A = mockCreateFileVersion.mock.calls[0][0].sha256;

    jest.clearAllMocks();
    mockGetFilesByUser.mockResolvedValue([]);
    mockCreateFile.mockImplementation(async (i) => ({ ...i } as StoredFile));
    mockCreateFileVersion.mockResolvedValue(storedVersion());
    mockSetActiveVersion.mockResolvedValue(storedVersion());

    await fileService.uploadFile("owner-1", multerFile({ buffer: Buffer.from("content B") }), {});
    const sha256B = mockCreateFileVersion.mock.calls[0][0].sha256;

    expect(sha256A).not.toBe(sha256B);
  });

  it("rejects when storage quota is exceeded", async () => {
    mockGetFilesByUser.mockResolvedValue([
      { ...storedFile(), size: fileService.MAX_USER_STORAGE_BYTES },
    ]);

    await expect(
      fileService.uploadFile("owner-1", multerFile(), {}),
    ).rejects.toThrow("Storage quota exceeded");
  });
});

// ─── downloadFile: signed URL ────────────────────────────────────────────────

describe("file.service downloadFile — signed S3 URL", () => {
  it("returns kind=signed with a presigned URL for an S3-backed file", async () => {
    mockRequireFileAccess.mockResolvedValue({ file: storedFile(), role: "owner" });
    mockGetActiveVersion.mockResolvedValue(storedVersion());

    const result = await fileService.downloadFile("file-1", "owner-1");

    expect(result.kind).toBe("signed");
    if (result.kind === "signed") {
      expect(result.url).toBe("https://s3.example.com/file?sig=abc&expires=900");
    }
  });

  it("requests a presigned URL with a 15-minute (900s) expiry", async () => {
    mockRequireFileAccess.mockResolvedValue({ file: storedFile(), role: "owner" });
    mockGetActiveVersion.mockResolvedValue(storedVersion());

    await fileService.downloadFile("file-1", "owner-1");

    expect(mockGetPresignedDownloadUrl).toHaveBeenCalledWith(
      "uploads/owner-1/file-1/v1_key.pdf",
      900,
    );
  });

  it("includes sha256 from the active version in the signed result", async () => {
    mockRequireFileAccess.mockResolvedValue({ file: storedFile(), role: "owner" });
    mockGetActiveVersion.mockResolvedValue(storedVersion({ sha256: "deadbeef1234deadbeef1234deadbeef1234deadbeef1234deadbeef12341234" }));

    const result = await fileService.downloadFile("file-1", "owner-1");

    expect(result.sha256).toBe("deadbeef1234deadbeef1234deadbeef1234deadbeef1234deadbeef12341234");
  });

  it("includes undefined sha256 when the version has none (pre-existing file)", async () => {
    mockRequireFileAccess.mockResolvedValue({ file: storedFile(), role: "owner" });
    mockGetActiveVersion.mockResolvedValue(storedVersion({ sha256: undefined }));

    const result = await fileService.downloadFile("file-1", "owner-1");

    expect(result.sha256).toBeUndefined();
  });

  it("does not call getObjectStream for S3-backed files", async () => {
    mockRequireFileAccess.mockResolvedValue({ file: storedFile(), role: "owner" });
    mockGetActiveVersion.mockResolvedValue(storedVersion());

    await fileService.downloadFile("file-1", "owner-1");

    expect(mockGetObjectStream).not.toHaveBeenCalled();
  });
});

// ─── downloadFile: legacy disk fallback ──────────────────────────────────────

describe("file.service downloadFile — legacy disk fallback", () => {
  it("returns kind=stream for a disk-backed file when no active S3 version exists", async () => {
    const file = storedFile({ diskPath: "/legacy/report.pdf" });
    mockRequireFileAccess.mockResolvedValue({ file, role: "owner" });
    mockGetActiveVersion.mockResolvedValue(undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "createReadStream").mockReturnValue(new Readable({ read() {} }) as any);

    const result = await fileService.downloadFile("file-1", "owner-1");

    expect(result.kind).toBe("stream");
    expect(mockGetPresignedDownloadUrl).not.toHaveBeenCalled();
  });

  it("sha256 is undefined for disk-backed files", async () => {
    const file = storedFile({ diskPath: "/legacy/report.pdf" });
    mockRequireFileAccess.mockResolvedValue({ file, role: "owner" });
    mockGetActiveVersion.mockResolvedValue(undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "createReadStream").mockReturnValue(new Readable({ read() {} }) as any);

    const result = await fileService.downloadFile("file-1", "owner-1");

    expect(result.sha256).toBeUndefined();
  });

  it("throws when the legacy file no longer exists on disk", async () => {
    const file = storedFile({ diskPath: "/deleted/report.pdf" });
    mockRequireFileAccess.mockResolvedValue({ file, role: "owner" });
    mockGetActiveVersion.mockResolvedValue(undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(false);

    await expect(fileService.downloadFile("file-1", "owner-1")).rejects.toThrow(
      "File no longer exists.",
    );
  });
});

// ─── streamFileDownload: sha256 propagation ──────────────────────────────────

describe("file.service streamFileDownload — sha256", () => {
  it("includes sha256 from the active version in the result", async () => {
    mockRequireFileAccess.mockResolvedValue({ file: storedFile(), role: "owner" });
    mockGetActiveVersion.mockResolvedValue(storedVersion({ sha256: "cafebabe9876cafebabe9876cafebabe9876cafebabe9876cafebabe98761234" }));

    const result = await fileService.streamFileDownload("file-1", "owner-1");

    expect(result.sha256).toBe("cafebabe9876cafebabe9876cafebabe9876cafebabe9876cafebabe98761234");
  });

  it("sha256 is undefined for disk-backed files", async () => {
    const file = storedFile({ diskPath: "/legacy/report.pdf" });
    mockRequireFileAccess.mockResolvedValue({ file, role: "owner" });
    mockGetActiveVersion.mockResolvedValue(undefined);
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "createReadStream").mockReturnValue(new Readable({ read() {} }) as any);

    const result = await fileService.streamFileDownload("file-1", "owner-1");

    expect(result.sha256).toBeUndefined();
  });
});
