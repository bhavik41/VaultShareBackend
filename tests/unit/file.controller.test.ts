import { Request, Response } from "express";
import { Readable } from "stream";
import { FileController } from "../../src/controllers/file.controller";
import type { StoredFile } from "../../src/db/fileStore";

jest.mock("../../src/services/file.service", () => ({
  listFiles: jest.fn(),
  uploadFile: jest.fn(),
  downloadFile: jest.fn(),
  streamFileDownload: jest.fn(),
  deleteFile: jest.fn(),
  getFileDetails: jest.fn(),
  setAdminOnlyChat: jest.fn(),
}));

jest.mock("../../src/utils/auditLogger", () => ({
  logAction: jest.fn(),
  logViewAction: jest.fn(),
}));

import * as fileService from "../../src/services/file.service";

const mockUploadFile = jest.mocked(fileService.uploadFile);
const mockDownloadFile = jest.mocked(fileService.downloadFile);
const mockStreamFileDownload = jest.mocked(fileService.streamFileDownload);

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    user: { id: "user-1", email: "user@example.com", name: "User", twoFactorEnabled: false },
    params: { fileId: "file-1" },
    body: {},
    headers: {},
    ...overrides,
  } as unknown as Request;
}

function makeRes() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
  };
  return res as unknown as Response & {
    status: jest.Mock;
    json: jest.Mock;
    setHeader: jest.Mock;
  };
}

const baseFile: StoredFile = {
  id: "file-1",
  name: "report.pdf",
  userId: "user-1",
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
} as StoredFile;

beforeEach(() => jest.clearAllMocks());

// ─── uploadFile: originalMimeType validation ──────────────────────────────────

describe("FileController.uploadFile — originalMimeType validation", () => {
  it("accepts a known originalMimeType and forwards it to the service", async () => {
    const req = makeReq({
      file: {
        mimetype: "application/vaultshare-encrypted",
        buffer: Buffer.alloc(0),
        originalname: "enc.bin",
        size: 0,
      } as any,
      body: { encrypted: "true", originalMimeType: "application/pdf" },
    });
    const res = makeRes();
    mockUploadFile.mockResolvedValue({ file: baseFile });

    await FileController.uploadFile(req, res);

    expect(mockUploadFile).toHaveBeenCalledWith(
      "user-1",
      expect.anything(),
      expect.objectContaining({ originalMimeType: "application/pdf" }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("rejects an unknown originalMimeType with 400 before calling the service", async () => {
    const req = makeReq({
      file: {
        mimetype: "application/pdf",
        buffer: Buffer.alloc(0),
        originalname: "file.pdf",
        size: 0,
      } as any,
      body: { originalMimeType: "application/x-evil-script" },
    });
    const res = makeRes();

    await FileController.uploadFile(req, res);

    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Invalid originalMimeType." });
  });

  it("rejects empty string originalMimeType with 400", async () => {
    const req = makeReq({
      file: { mimetype: "application/pdf", buffer: Buffer.alloc(0), originalname: "file.pdf", size: 0 } as any,
      body: { originalMimeType: "" },
    });
    const res = makeRes();

    await FileController.uploadFile(req, res);

    expect(mockUploadFile).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("passes originalMimeType: undefined when the field is absent", async () => {
    const req = makeReq({
      file: { mimetype: "application/pdf", buffer: Buffer.alloc(0), originalname: "file.pdf", size: 0 } as any,
      body: {},
    });
    const res = makeRes();
    mockUploadFile.mockResolvedValue({ file: baseFile });

    await FileController.uploadFile(req, res);

    expect(mockUploadFile).toHaveBeenCalledWith(
      "user-1",
      expect.anything(),
      expect.objectContaining({ originalMimeType: undefined }),
    );
  });

  it("returns 400 when no file is provided", async () => {
    const req = makeReq({ file: undefined });
    const res = makeRes();

    await FileController.uploadFile(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "No file provided." });
  });
});

// ─── downloadFile: signed URL + X-Content-Hash ───────────────────────────────

describe("FileController.downloadFile — signed URL", () => {
  it("returns JSON { url, sha256 } and sets X-Content-Hash for an S3-backed file", async () => {
    const res = makeRes();
    mockDownloadFile.mockResolvedValue({
      kind: "signed",
      url: "https://s3.example.com/file?sig=abc",
      sha256: "deadbeef1234deadbeef1234deadbeef1234deadbeef1234deadbeef12341234",
      file: baseFile,
    });

    await FileController.downloadFile(makeReq(), res);

    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Content-Hash",
      "deadbeef1234deadbeef1234deadbeef1234deadbeef1234deadbeef12341234",
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      url: "https://s3.example.com/file?sig=abc",
      sha256: "deadbeef1234deadbeef1234deadbeef1234deadbeef1234deadbeef12341234",
    });
  });

  it("does not set X-Content-Hash when sha256 is absent (pre-existing file)", async () => {
    const res = makeRes();
    mockDownloadFile.mockResolvedValue({
      kind: "signed",
      url: "https://s3.example.com/file",
      sha256: undefined,
      file: baseFile,
    });

    await FileController.downloadFile(makeReq(), res);

    const hashCall = (res.setHeader as jest.Mock).mock.calls.find(
      ([header]) => header === "X-Content-Hash",
    );
    expect(hashCall).toBeUndefined();
  });

  it("returns json with sha256: null when sha256 is absent", async () => {
    const res = makeRes();
    mockDownloadFile.mockResolvedValue({
      kind: "signed",
      url: "https://s3.example.com/file",
      sha256: undefined,
      file: baseFile,
    });

    await FileController.downloadFile(makeReq(), res);

    expect(res.json).toHaveBeenCalledWith({ url: "https://s3.example.com/file", sha256: null });
  });
});

describe("FileController.downloadFile — legacy stream", () => {
  it("pipes the stream to the response and sets X-Content-Hash", async () => {
    const res = makeRes();
    const stream = new Readable({ read() {} });
    stream.pipe = jest.fn();
    mockDownloadFile.mockResolvedValue({
      kind: "stream",
      stream,
      sha256: "legacyhashlegacyhashlegacyhashlegacyhashlegacyhashlegacyhash1234",
      file: baseFile,
    });

    await FileController.downloadFile(makeReq(), res);

    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Content-Hash",
      "legacyhashlegacyhashlegacyhashlegacyhashlegacyhashlegacyhash1234",
    );
    expect(stream.pipe).toHaveBeenCalledWith(res);
    expect(res.json).not.toHaveBeenCalled();
  });

  it("returns 403 when access is denied", async () => {
    const res = makeRes();
    mockDownloadFile.mockRejectedValue(new Error("Access denied."));

    await FileController.downloadFile(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ message: "Access denied." });
  });

  it("returns 404 when file is not found", async () => {
    const res = makeRes();
    mockDownloadFile.mockRejectedValue(new Error("File not found."));

    await FileController.downloadFile(makeReq(), res);

    expect(res.status).toHaveBeenCalledWith(404);
  });
});

// ─── previewFile: X-Content-Hash ─────────────────────────────────────────────

describe("FileController.previewFile — X-Content-Hash", () => {
  it("sets X-Content-Hash when sha256 is available", async () => {
    const res = makeRes();
    const stream = new Readable({ read() {} });
    stream.pipe = jest.fn();
    mockStreamFileDownload.mockResolvedValue({
      stream,
      originalName: "report.pdf",
      mimeType: "application/pdf",
      size: 1024,
      sha256: "preview_hash_preview_hash_preview_hash_preview_hash_preview_ha",
    });

    await FileController.previewFile(makeReq(), res);

    expect(res.setHeader).toHaveBeenCalledWith(
      "X-Content-Hash",
      "preview_hash_preview_hash_preview_hash_preview_hash_preview_ha",
    );
    expect(stream.pipe).toHaveBeenCalledWith(res);
  });

  it("does not set X-Content-Hash when sha256 is absent", async () => {
    const res = makeRes();
    const stream = new Readable({ read() {} });
    stream.pipe = jest.fn();
    mockStreamFileDownload.mockResolvedValue({
      stream,
      originalName: "report.pdf",
      mimeType: "application/pdf",
      size: 1024,
      sha256: undefined,
    });

    await FileController.previewFile(makeReq(), res);

    const hashCall = (res.setHeader as jest.Mock).mock.calls.find(
      ([header]) => header === "X-Content-Hash",
    );
    expect(hashCall).toBeUndefined();
  });
});
