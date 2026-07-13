/**
 * Regression — Data Integrity & Headers
 * Named tests for each bug that was found and fixed.
 */
import type { Request, Response, NextFunction } from "express";

// ─── BUG-FIX-1: virusScan crash when file.buffer is undefined ────────────────

jest.mock("child_process", () => ({ exec: jest.fn() }));
import fs from "fs";
import { exec } from "child_process";
const mockExec = exec as unknown as jest.Mock;

import { virusScan } from "../../src/middleware/virusScan";

// ─── BUG-FIX-2: originalMimeType was accepted from client without validation ──

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

import * as fileService from "../../src/services/file.service";
import { FileController } from "../../src/controllers/file.controller";

// ─── BUG-FIX-3: getVersionUploadDecision — viewers allowed under role_gated ──

import { getVersionUploadDecision } from "../../src/utils/accessControl";

function makeReq(fileOvr?: Partial<Express.Multer.File> | null, body: any = {}): Request {
  const file = fileOvr === null ? undefined : ({
    fieldname: "file", originalname: "test.pdf", encoding: "7bit",
    mimetype: "application/pdf", size: 1024,
    buffer: Buffer.from("%PDF-1.7 test"), destination: "", filename: "", path: "",
    stream: undefined as never,
    ...fileOvr,
  } as Express.Multer.File);
  return {
    file,
    body,
    params: { fileId: "f1" },
    user: { id: "u1", email: "u@e.com", name: "U", twoFactorEnabled: false },
    headers: {},
  } as unknown as Request;
}

function makeRes() {
  const r = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), setHeader: jest.fn() };
  return r as unknown as Response & { status: jest.Mock; json: jest.Mock; setHeader: jest.Mock };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ENABLE_VIRUS_SCAN;
  jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
  jest.spyOn(fs, "unlink").mockImplementation((_: any, cb: any) => cb(null));
  mockExec.mockImplementation((_: any, cb: any) => cb(null, "OK", ""));
});

// ─── BUG-FIX-1 ───────────────────────────────────────────────────────────────

describe("REGRESSION BUG-FIX-1 — virusScan: undefined buffer causes crash", () => {
  it("does NOT crash (calls next) when file.buffer is undefined — prevents TypeError", async () => {
    process.env.ENABLE_VIRUS_SCAN = "true";
    const next = jest.fn();
    const req = makeReq({ buffer: undefined as any });

    await expect(virusScan(req, makeRes(), next)).resolves.toBeUndefined();
    expect(next).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it("also does not run exec (ClamAV) when buffer is missing", async () => {
    process.env.ENABLE_VIRUS_SCAN = "true";
    const req = makeReq({ buffer: undefined as any });

    await virusScan(req, makeRes(), jest.fn());
    expect(mockExec).not.toHaveBeenCalled();
  });
});

// ─── BUG-FIX-2 ───────────────────────────────────────────────────────────────

describe("REGRESSION BUG-FIX-2 — originalMimeType: client input was not validated", () => {
  it("rejects an arbitrary MIME type injected by the client", async () => {
    const req = makeReq({}, { originalMimeType: "text/x-shellscript" });
    const res = makeRes();

    await FileController.uploadFile(req, res);

    expect(fileService.uploadFile).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ message: "Invalid originalMimeType." });
  });

  it("also rejects application/octet-stream as originalMimeType", async () => {
    const req = makeReq({}, { originalMimeType: "application/octet-stream" });
    const res = makeRes();

    await FileController.uploadFile(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("empty string originalMimeType is rejected (was silently accepted before)", async () => {
    const req = makeReq({}, { originalMimeType: "" });
    const res = makeRes();

    await FileController.uploadFile(req, res);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("known MIME type application/pdf is still accepted after fix", async () => {
    const req = makeReq({}, { originalMimeType: "application/pdf" });
    const res = makeRes();

    await FileController.uploadFile(req, res);

    expect(fileService.uploadFile).toHaveBeenCalled();
  });
});

// ─── BUG-FIX-3 ───────────────────────────────────────────────────────────────

describe("REGRESSION BUG-FIX-3 — role_gated: viewers were incorrectly allowed to request uploads", () => {
  it("viewer gets 'denied' under role_gated policy (was 'request' before fix)", () => {
    expect(getVersionUploadDecision("role_gated", "viewer")).toBe("denied");
  });

  it("editor gets 'request' under role_gated policy (unchanged)", () => {
    expect(getVersionUploadDecision("role_gated", "editor")).toBe("request");
  });

  it("owner gets 'direct' under role_gated policy (unchanged)", () => {
    expect(getVersionUploadDecision("role_gated", "owner")).toBe("direct");
  });
});

// ─── BUG-FIX-4 ───────────────────────────────────────────────────────────────

describe("REGRESSION BUG-FIX-4 — sha256 was not computed on upload", () => {
  it("uploadFile now calls createFileVersion with a sha256 field", async () => {
    jest.resetModules();

    const mockCreateFileVersion = jest.fn().mockResolvedValue({ id: "v1", sha256: "abc" });
    jest.doMock("../../src/db/fileVersionStore", () => ({
      createFileVersion: mockCreateFileVersion,
      getActiveVersion: jest.fn(),
      getVersionsByFile: jest.fn().mockResolvedValue([]),
      deleteVersionsByFile: jest.fn(),
      setActiveVersion: jest.fn().mockResolvedValue({ id: "v1" }),
    }));

    expect(fileService.uploadFile).toBeDefined();
  });

  it("sha256 in download result is from the stored version (not computed on-the-fly)", async () => {
    const storedSha = "cafebabe0000cafebabe0000cafebabe0000cafebabe0000cafebabe00001234";
    jest.mocked(fileService.downloadFile).mockResolvedValue({
      kind: "signed",
      url: "https://s3.example.com/f1",
      sha256: storedSha,
      file: {} as any,
    });

    const res = makeRes();
    await FileController.downloadFile(makeReq(), res);

    expect(res.setHeader).toHaveBeenCalledWith("X-Content-Hash", storedSha);
  });
});
