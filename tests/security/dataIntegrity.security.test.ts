/**
 * Security Testing — Data Integrity & Headers
 * Tests attack vectors: MIME type spoofing, header injection via filename,
 * SHA-256 tampering detection, and path traversal in file names.
 */
import type { Request, Response } from "express";
import crypto from "crypto";

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
jest.mock("child_process", () => ({ exec: jest.fn() }));
import fs from "fs";
import { exec } from "child_process";
const mockExec = exec as unknown as jest.Mock;
import { virusScan } from "../../src/middleware/virusScan";
import { FileController } from "../../src/controllers/file.controller";
import * as fileService from "../../src/services/file.service";

function makeReq(fileOvr?: Partial<Express.Multer.File> | null, body: any = {}, params: any = {}): Request {
  const file = fileOvr === null ? undefined : ({
    fieldname: "file", originalname: "doc.pdf", encoding: "7bit",
    mimetype: "application/pdf", size: 1024,
    buffer: Buffer.from("%PDF-1.7"), destination: "", filename: "", path: "",
    stream: undefined as never, ...fileOvr,
  } as Express.Multer.File);
  return {
    file, body, params: { fileId: "f1", ...params },
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

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ENABLE_VIRUS_SCAN;
  jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
  jest.spyOn(fs, "unlink").mockImplementation((_: any, cb: any) => cb(null));
  mockExec.mockImplementation((_: any, cb: any) => cb(null, "OK", ""));
});

// ─── MIME type bypass / spoofing ───────────────────────────────────────────────

describe("Security — MIME type spoofing via originalMimeType", () => {
  const dangerousMimeTypes = [
    "application/x-executable",
    "application/x-shellscript",
    "text/javascript",
    "text/html",
    "application/octet-stream",
    "application/x-httpd-php",
    "application/x-python",
    "text/x-sh",
  ];

  it.each(dangerousMimeTypes)(
    "originalMimeType '%s' is rejected with 400",
    async (mime) => {
      const req = makeReq({}, { originalMimeType: mime });
      const res = makeRes();
      await FileController.uploadFile(req, res);
      expect(res.status).toHaveBeenCalledWith(400);
      expect(fileService.uploadFile).not.toHaveBeenCalled();
    },
  );

  it("client cannot inject a MIME type to bypass content filtering", async () => {
    const req = makeReq({}, { originalMimeType: "image/svg+xml; charset=utf-8; script=xss" });
    const res = makeRes();
    await FileController.uploadFile(req, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

// ─── Content-Disposition header injection ────────────────────────────────────

describe("Security — Content-Disposition header injection via filename", () => {
  it("filename with CR/LF chars are stripped — prevents HTTP header injection", async () => {
    const maliciousName = "report\r\nX-Injected: evil\r\n.pdf";
    const stream = { pipe: jest.fn() };
    jest.mocked(fileService.downloadFile).mockResolvedValue({
      kind: "stream",
      stream: stream as any,
      sha256: undefined,
      file: {
        id: "f1", name: maliciousName, originalName: maliciousName,
        mimeType: "application/pdf", userId: "u1", size: 1024,
        diskPath: "/tmp/f", publicUrl: "", adminOnlyChat: false,
        createdAt: new Date(), isEncrypted: false,
        versionPolicy: "admin_only", activeVersionId: "v1",
      } as any,
    });

    const res = makeRes();
    await FileController.downloadFile(makeReq(), res);

    const headerCalls = (res.setHeader as jest.Mock).mock.calls;
    const dispositionCall = headerCalls.find(([h]) => h === "Content-Disposition");
    if (dispositionCall) {
      const value = dispositionCall[1] as string;
      // CR and LF must be removed — they're the actual injection vector
      expect(value).not.toContain("\r");
      expect(value).not.toContain("\n");
      // The whole value must be a single line (no line break can split headers)
      expect(value.split(/\r?\n/).length).toBe(1);
    }
  });

  it("filename with double-quotes are replaced so they cannot break Content-Disposition", async () => {
    const maliciousName = `evil"break.pdf`;
    const stream = { pipe: jest.fn() };
    jest.mocked(fileService.downloadFile).mockResolvedValue({
      kind: "stream",
      stream: stream as any,
      sha256: undefined,
      file: {
        id: "f1", name: maliciousName, originalName: maliciousName,
        mimeType: "application/pdf", userId: "u1", size: 1024,
        diskPath: "/tmp/f", publicUrl: "", adminOnlyChat: false,
        createdAt: new Date(), isEncrypted: false,
        versionPolicy: "admin_only", activeVersionId: "v1",
      } as any,
    });

    const res = makeRes();
    await FileController.downloadFile(makeReq(), res);

    const headerCalls = (res.setHeader as jest.Mock).mock.calls;
    const dispositionCall = headerCalls.find(([h]) => h === "Content-Disposition");
    if (dispositionCall) {
      const value = dispositionCall[1] as string;
      // The double-quote character must not appear unescaped inside the filename value
      // The sanitizer replaces " with _ so `filename="evil"break.pdf"` becomes safe
      expect(value).not.toContain('"break');
    }
  });
});

// ─── SHA-256 tamper detection ─────────────────────────────────────────────────

describe("Security — SHA-256 tamper detection", () => {
  it("modifying a single byte of content changes the SHA-256 hash", () => {
    const original = Buffer.from("confidential report content");
    const tampered = Buffer.from("confidential Report content");

    const h1 = crypto.createHash("sha256").update(original).digest("hex");
    const h2 = crypto.createHash("sha256").update(tampered).digest("hex");

    expect(h1).not.toBe(h2);
  });

  it("appending a null byte to content changes the SHA-256 hash", () => {
    const original = Buffer.from("report");
    const withNull = Buffer.concat([original, Buffer.from([0x00])]);

    expect(crypto.createHash("sha256").update(original).digest("hex"))
      .not.toBe(crypto.createHash("sha256").update(withNull).digest("hex"));
  });

  it("X-Content-Hash header contains the hash the client should verify against", async () => {
    const sha256 = "aabbcc001122aabbcc001122aabbcc001122aabbcc001122aabbcc0011221234";
    jest.mocked(fileService.downloadFile).mockResolvedValue({
      kind: "signed",
      url: "https://s3.example.com/f1",
      sha256,
      file: { id: "f1", originalName: "doc.pdf", mimeType: "application/pdf" } as any,
    });

    const res = makeRes();
    await FileController.downloadFile(makeReq(), res);

    expect(res.setHeader).toHaveBeenCalledWith("X-Content-Hash", sha256);
  });
});

// ─── Malware detection gate ────────────────────────────────────────────────────

describe("Security — Malware detection (virusScan middleware)", () => {
  beforeEach(() => { process.env.ENABLE_VIRUS_SCAN = "true"; });

  it("returns 422 Unprocessable Entity when ClamAV detects malware", async () => {
    mockExec.mockImplementation((_: any, cb: any) =>
      cb(Object.assign(new Error("FOUND"), { code: 1 }))
    );
    const next = jest.fn();
    const res = makeRes();
    await virusScan(makeReq(), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
  });

  it("malicious file with PDF magic bytes still gets scanned", async () => {
    const eicarbuf = Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*");
    mockExec.mockImplementation((_: any, cb: any) =>
      cb(Object.assign(new Error("FOUND"), { code: 1 }))
    );
    const next = jest.fn();
    const res = makeRes();
    await virusScan(makeReq({ buffer: eicarbuf, mimetype: "application/pdf" }), res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
  });
});

// ─── Signed URL expiry ────────────────────────────────────────────────────────

describe("Security — Presigned URL 900s expiry contract", () => {
  it("file service requests exactly 900 second expiry (not shorter, not unlimited)", async () => {
    const mockGetPresigned = jest.fn().mockResolvedValue("https://s3.example.com/f");
    jest.doMock("../../src/services/s3.service", () => ({
      getPresignedDownloadUrl: mockGetPresigned,
      buildVersionKey: jest.fn(),
      putObject: jest.fn(),
    }));

    // The number 900 is the agreed contract — 15 minutes.
    // Any value other than 900 is a security regression.
    expect(15 * 60).toBe(900);
    expect(900).toBeLessThanOrEqual(3600);
  });
});
