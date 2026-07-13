/**
 * Usability Testing — Data Integrity & Headers
 * Verifies that file API error messages are clear, header values are
 * client-readable, and responses guide client developers to the right behavior.
 */
import type { Request, Response } from "express";

jest.mock("../../src/services/file.service", () => ({
  uploadFile: jest.fn().mockResolvedValue({ file: { id: "f1", name: "doc.pdf" } }),
  downloadFile: jest.fn(),
  streamFileDownload: jest.fn(),
  listFiles: jest.fn(),
  deleteFile: jest.fn(),
  getFileDetails: jest.fn(),
  setAdminOnlyChat: jest.fn(),
}));
jest.mock("../../src/utils/auditLogger", () => ({
  logAction: jest.fn(),
  logViewAction: jest.fn(),
}));

import { FileController } from "../../src/controllers/file.controller";
import * as fileService from "../../src/services/file.service";

function makeReq(fileOvr?: Partial<Express.Multer.File> | null, body: any = {}): Request {
  const file = fileOvr === null ? undefined : ({
    fieldname: "file", originalname: "doc.pdf", encoding: "7bit",
    mimetype: "application/pdf", size: 1024,
    buffer: Buffer.from("%PDF-1.7"), destination: "", filename: "", path: "",
    stream: undefined as never, ...fileOvr,
  } as Express.Multer.File);
  return {
    file, body, params: { fileId: "f1" },
    user: { id: "u1", email: "u@e.com", name: "U", twoFactorEnabled: false },
    headers: {},
  } as unknown as Request;
}

function makeRes() {
  const r: any = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    setHeader: jest.fn(),
  };
  return r as Response & { status: jest.Mock; json: jest.Mock; setHeader: jest.Mock };
}

beforeEach(() => jest.clearAllMocks());

// ─── Upload error messages are specific ───────────────────────────────────────

describe("Usability — upload error messages guide the developer", () => {
  it("'No file provided.' — exact, actionable message when file is missing", async () => {
    const res = makeRes();
    await FileController.uploadFile(makeReq(null), res);
    expect(res.json).toHaveBeenCalledWith({ message: "No file provided." });
  });

  it("'Invalid originalMimeType.' — names the invalid field explicitly", async () => {
    const res = makeRes();
    await FileController.uploadFile(makeReq({}, { originalMimeType: "text/javascript" }), res);
    expect(res.json).toHaveBeenCalledWith({ message: "Invalid originalMimeType." });
  });

  it("upload error response always has { message } field", async () => {
    const res = makeRes();
    await FileController.uploadFile(makeReq(null), res);
    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(typeof jsonArg.message).toBe("string");
  });
});

// ─── Download response is client-consumable ───────────────────────────────────

describe("Usability — download response helps client consume signed URLs", () => {
  it("signed download response has { url, sha256 } — both fields present for client use", async () => {
    const sha256 = "aabbcc001122aabbcc001122aabbcc001122aabbcc001122aabbcc0011221234";
    jest.mocked(fileService.downloadFile).mockResolvedValue({
      kind: "signed",
      url: "https://s3.example.com/f1?sig=abc",
      sha256,
      file: { id: "f1", originalName: "doc.pdf", mimeType: "application/pdf" } as any,
    });

    const res = makeRes();
    await FileController.downloadFile(makeReq(), res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body).toHaveProperty("url");
    expect(body).toHaveProperty("sha256");
  });

  it("sha256 is null (not undefined/missing) when not available — consistent JSON", async () => {
    jest.mocked(fileService.downloadFile).mockResolvedValue({
      kind: "signed",
      url: "https://s3.example.com/f1",
      sha256: undefined,
      file: { id: "f1", originalName: "doc.pdf", mimeType: "application/pdf" } as any,
    });

    const res = makeRes();
    await FileController.downloadFile(makeReq(), res);

    const body = (res.json as jest.Mock).mock.calls[0][0];
    expect(body.sha256).toBeNull();
    expect("sha256" in body).toBe(true);
  });
});

// ─── X-Content-Hash header format is readable ──────────────────────────────────

describe("Usability — X-Content-Hash header format", () => {
  it("X-Content-Hash value is a readable lowercase hex string (not base64, not binary)", async () => {
    const sha256 = "deadbeef1234deadbeef1234deadbeef1234deadbeef1234deadbeef12341234";
    jest.mocked(fileService.downloadFile).mockResolvedValue({
      kind: "signed",
      url: "https://s3.example.com/f1",
      sha256,
      file: { id: "f1", originalName: "doc.pdf", mimeType: "application/pdf" } as any,
    });

    const res = makeRes();
    await FileController.downloadFile(makeReq(), res);

    const headerValue = (res.setHeader as jest.Mock).mock.calls
      .find(([h]) => h === "X-Content-Hash")?.[1];

    expect(headerValue).toMatch(/^[0-9a-f]{64}$/);
    expect(headerValue).not.toMatch(/[A-F]/);
    expect(headerValue).not.toMatch(/[+/=]/);
  });

  it("X-Content-Hash is absent (not 'null' or 'undefined') when hash not available", async () => {
    jest.mocked(fileService.downloadFile).mockResolvedValue({
      kind: "signed",
      url: "https://s3.example.com/f1",
      sha256: undefined,
      file: { id: "f1", originalName: "doc.pdf", mimeType: "application/pdf" } as any,
    });

    const res = makeRes();
    await FileController.downloadFile(makeReq(), res);

    const hashCall = (res.setHeader as jest.Mock).mock.calls
      .find(([h]) => h === "X-Content-Hash");
    expect(hashCall).toBeUndefined();
  });
});

// ─── Download error messages use correct HTTP codes ────────────────────────────

describe("Usability — download error HTTP status codes are correct", () => {
  it("'Access denied.' → 403 Forbidden (not 401, not 400)", async () => {
    jest.mocked(fileService.downloadFile).mockRejectedValue(new Error("Access denied."));
    const res = makeRes();
    await FileController.downloadFile(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("'File not found.' → 404 Not Found (not 400, not 500)", async () => {
    jest.mocked(fileService.downloadFile).mockRejectedValue(new Error("File not found."));
    const res = makeRes();
    await FileController.downloadFile(makeReq(), res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("error response body has { message } field", async () => {
    jest.mocked(fileService.downloadFile).mockRejectedValue(new Error("Access denied."));
    const res = makeRes();
    await FileController.downloadFile(makeReq(), res);
    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(typeof jsonArg.message).toBe("string");
  });
});

// ─── MIME type validation message ─────────────────────────────────────────────

describe("Usability — originalMimeType validation is self-documenting", () => {
  it("error message mentions 'originalMimeType' so client knows which field is wrong", async () => {
    const res = makeRes();
    await FileController.uploadFile(makeReq({}, { originalMimeType: "application/x-evil" }), res);
    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg.message).toContain("originalMimeType");
  });

  it("valid originalMimeType passes without any error message", async () => {
    const res = makeRes();
    await FileController.uploadFile(makeReq({}, { originalMimeType: "application/pdf" }), res);
    expect(res.status).not.toHaveBeenCalledWith(400);
    expect(fileService.uploadFile).toHaveBeenCalled();
  });
});
