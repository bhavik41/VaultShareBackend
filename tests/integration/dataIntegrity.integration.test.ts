/**
 * Integration — Data Integrity & Headers
 * Tests file service + real crypto (SHA-256) + version chain interactions.
 * Only DB and S3 layers are mocked.
 */
import crypto from "crypto";

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
  buildVersionKey: jest.fn().mockReturnValue("uploads/u1/f1/v1.pdf"),
  putObject: jest.fn().mockResolvedValue(undefined),
  getPresignedDownloadUrl: jest.fn().mockResolvedValue("https://s3.example.com/f1?sig=x"),
  getObjectStream: jest.fn(),
  deleteObject: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../../src/utils/accessControl", () => ({
  requireFileAccess: jest.fn(),
}));

import * as fileStore from "../../src/db/fileStore";
import * as versionStore from "../../src/db/fileVersionStore";
import * as s3 from "../../src/services/s3.service";
import * as accessControl from "../../src/utils/accessControl";
import * as fileService from "../../src/services/file.service";
import type { StoredFile } from "../../src/db/fileStore";
import type { StoredFileVersion } from "../../src/db/fileVersionStore";

const mockGetFiles = jest.mocked(fileStore.getFilesByUser);
const mockCreateFile = jest.mocked(fileStore.createFile);
const mockCreateVersion = jest.mocked(versionStore.createFileVersion);
const mockSetActive = jest.mocked(versionStore.setActiveVersion);
const mockGetActive = jest.mocked(versionStore.getActiveVersion);
const mockGetPresigned = jest.mocked(s3.getPresignedDownloadUrl);
const mockRequireAccess = jest.mocked(accessControl.requireFileAccess);

function file(o: Partial<StoredFile> = {}): StoredFile {
  return {
    id: "f1", name: "doc.pdf", userId: "u1", originalName: "doc.pdf",
    mimeType: "application/pdf", size: 1024, diskPath: "", publicUrl: "/api/files/f1/download",
    adminOnlyChat: false, createdAt: new Date(), isEncrypted: false,
    versionPolicy: "admin_only", activeVersionId: "v1", ...o,
  } as StoredFile;
}

function version(o: Partial<StoredFileVersion> = {}): StoredFileVersion {
  return {
    id: "v1", fileId: "f1", versionNumber: 1, uploadedBy: "u1",
    s3Key: "uploads/u1/f1/v1.pdf", originalName: "doc.pdf", size: 1024,
    mimeType: "application/pdf", isActive: true, isEncrypted: false,
    sha256: "abc123def456abc123def456abc123def456abc123def456abc123def456abc1",
    createdAt: new Date(), ...o,
  };
}

function multerFile(buf: Buffer): Express.Multer.File {
  return {
    fieldname: "file", originalname: "doc.pdf", encoding: "7bit",
    mimetype: "application/pdf", size: buf.length, buffer: buf,
    destination: "", filename: "", path: "", stream: undefined as never,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFiles.mockResolvedValue([]);
  mockCreateFile.mockImplementation(async (i) => ({ ...i } as StoredFile));
  mockCreateVersion.mockResolvedValue(version());
  mockSetActive.mockResolvedValue(version());
});

// ─── SHA-256 service integration ─────────────────────────────────────────────

describe("Data Integrity Integration — sha256 computed via real crypto", () => {
  it("sha256 saved to DB matches independent crypto.createHash computation", async () => {
    const buf = Buffer.from("VaultShare integration test content");
    const expected = crypto.createHash("sha256").update(buf).digest("hex");

    await fileService.uploadFile("u1", multerFile(buf), {});

    expect(mockCreateVersion).toHaveBeenCalledWith(
      expect.objectContaining({ sha256: expected }),
    );
  });

  it("uploading two different files produces two different sha256 values", async () => {
    const sha256s: string[] = [];
    mockCreateVersion.mockImplementation(async (v) => {
      sha256s.push(v.sha256!);
      return version({ sha256: v.sha256 });
    });

    await fileService.uploadFile("u1", multerFile(Buffer.from("file A content")), {});
    await fileService.uploadFile("u1", multerFile(Buffer.from("file B content")), {});

    expect(sha256s[0]).not.toBe(sha256s[1]);
  });

  it("uploading identical content always produces the same sha256", async () => {
    const sha256s: string[] = [];
    mockCreateVersion.mockImplementation(async (v) => {
      sha256s.push(v.sha256!);
      return version({ sha256: v.sha256 });
    });

    const buf = Buffer.from("deterministic content");
    await fileService.uploadFile("u1", multerFile(buf), {});
    await fileService.uploadFile("u1", multerFile(buf), {});

    expect(sha256s[0]).toBe(sha256s[1]);
  });
});

// ─── downloadFile → signed URL + sha256 propagation ──────────────────────────

describe("Data Integrity Integration — download returns sha256 from version chain", () => {
  it("sha256 in download result matches what was stored in the version", async () => {
    const stored = "deadbeef1234deadbeef1234deadbeef1234deadbeef1234deadbeef12341234";
    mockRequireAccess.mockResolvedValue({ file: file(), role: "owner" });
    mockGetActive.mockResolvedValue(version({ sha256: stored }));

    const result = await fileService.downloadFile("f1", "u1");
    expect(result.sha256).toBe(stored);
  });

  it("signed URL and sha256 come from the same version record", async () => {
    const sha256 = "cafebabe0000cafebabe0000cafebabe0000cafebabe0000cafebabe00001234";
    const s3Key = "uploads/u1/f1/v2_report.pdf";
    mockRequireAccess.mockResolvedValue({ file: file(), role: "owner" });
    mockGetActive.mockResolvedValue(version({ sha256, s3Key }));

    await fileService.downloadFile("f1", "u1");

    expect(mockGetPresigned).toHaveBeenCalledWith(s3Key, expect.any(Number));
  });
});

// ─── streamFileDownload → sha256 propagation ──────────────────────────────────

import fs from "fs";
import { Readable } from "stream";

describe("Data Integrity Integration — streamFileDownload sha256", () => {
  beforeEach(() => {
    jest.spyOn(fs, "existsSync").mockReturnValue(false);
    jest.spyOn(fs, "createReadStream").mockReturnValue(new Readable({ read() {} }) as any);
  });

  it("sha256 propagates through resolveContent and into the stream result", async () => {
    const sha256 = "streambabe1234streambabe1234streambabe1234streambabe1234streambabe";
    jest.mocked(s3.getObjectStream).mockResolvedValue(new Readable({ read() {} }));
    mockRequireAccess.mockResolvedValue({ file: file(), role: "viewer" });
    mockGetActive.mockResolvedValue(version({ sha256 }));

    const result = await fileService.streamFileDownload("f1", "u1");
    expect(result.sha256).toBe(sha256);
  });

  it("sha256 is undefined for files with no active version (legacy)", async () => {
    jest.spyOn(fs, "existsSync").mockReturnValue(true);
    jest.spyOn(fs, "createReadStream").mockReturnValue(new Readable({ read() {} }) as any);
    mockRequireAccess.mockResolvedValue({ file: file({ diskPath: "/legacy/doc.pdf" }), role: "viewer" });
    mockGetActive.mockResolvedValue(undefined);

    const result = await fileService.streamFileDownload("f1", "u1");
    expect(result.sha256).toBeUndefined();
  });
});

// ─── Storage quota integration ─────────────────────────────────────────────────

describe("Data Integrity Integration — storage quota gate", () => {
  it("rejects a file that would push the user over the 1 GB quota", async () => {
    const nearFullSize = fileService.MAX_USER_STORAGE_BYTES - 100;
    mockGetFiles.mockResolvedValue([{ ...file(), size: nearFullSize }]);

    const bigBuf = Buffer.alloc(200);
    await expect(fileService.uploadFile("u1", multerFile(bigBuf), {})).rejects.toThrow("Storage quota exceeded");
  });

  it("accepts a file that keeps the user exactly at the quota limit", async () => {
    const currentBytes = fileService.MAX_USER_STORAGE_BYTES - 512;
    mockGetFiles.mockResolvedValue([{ ...file(), size: currentBytes }]);

    const buf = Buffer.alloc(512);
    mockCreateVersion.mockResolvedValue(version({ size: 512 }));
    await expect(fileService.uploadFile("u1", multerFile(buf), {})).resolves.toBeDefined();
  });
});
