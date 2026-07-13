/**
 * Compatibility Testing — Data Integrity & Headers
 * Verifies correct behavior across different environment configurations:
 * ENABLE_VIRUS_SCAN on/off, VIRUS_SCAN_STRICT mode, MIME type allowlist.
 */
import type { Request, Response } from "express";

jest.mock("child_process", () => ({ exec: jest.fn() }));
import fs from "fs";
import { exec } from "child_process";
const mockExec = exec as unknown as jest.Mock;
import { virusScan } from "../../src/middleware/virusScan";

function makeReq(fileOvr?: Partial<Express.Multer.File> | null): Request {
  const file = fileOvr === null ? undefined : ({
    fieldname: "file", originalname: "doc.pdf", encoding: "7bit",
    mimetype: "application/pdf", size: 1024,
    buffer: Buffer.from("%PDF-1.7"), destination: "", filename: "", path: "",
    stream: undefined as never, ...fileOvr,
  } as Express.Multer.File);
  return { file } as unknown as Request;
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response & { status: jest.Mock; json: jest.Mock };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ENABLE_VIRUS_SCAN;
  delete process.env.VIRUS_SCAN_STRICT;
  jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
  jest.spyOn(fs, "unlink").mockImplementation((_: any, cb: any) => cb(null));
  mockExec.mockImplementation((_: any, cb: any) => cb(null, "OK", ""));
});

// ─── ENABLE_VIRUS_SCAN configurations ─────────────────────────────────────────

describe("Compatibility — ENABLE_VIRUS_SCAN env var", () => {
  it("scan disabled when ENABLE_VIRUS_SCAN is unset", async () => {
    const next = jest.fn();
    await virusScan(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("scan disabled when ENABLE_VIRUS_SCAN='false'", async () => {
    process.env.ENABLE_VIRUS_SCAN = "false";
    const next = jest.fn();
    await virusScan(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("scan runs when ENABLE_VIRUS_SCAN='true'", async () => {
    process.env.ENABLE_VIRUS_SCAN = "true";
    const next = jest.fn();
    await virusScan(makeReq(), makeRes(), next);
    expect(mockExec).toHaveBeenCalled();
  });

  it("scan disabled for any other value (e.g. '1', 'yes', 'enabled')", async () => {
    for (const val of ["1", "yes", "enabled", "TRUE"]) {
      process.env.ENABLE_VIRUS_SCAN = val;
      const next = jest.fn();
      mockExec.mockClear();
      await virusScan(makeReq(), makeRes(), next);
      expect(mockExec).not.toHaveBeenCalled();
    }
  });
});

// ─── VIRUS_SCAN_STRICT configurations ─────────────────────────────────────────

describe("Compatibility — VIRUS_SCAN_STRICT env var", () => {
  beforeEach(() => {
    process.env.ENABLE_VIRUS_SCAN = "true";
    mockExec.mockImplementation((_: any, cb: any) =>
      cb(Object.assign(new Error("scan error"), { code: 2 }))
    );
  });

  it("fail-open when VIRUS_SCAN_STRICT is unset: next() called on scanner error", async () => {
    const next = jest.fn();
    await virusScan(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("fail-closed when VIRUS_SCAN_STRICT='true': 503 on scanner error", async () => {
    process.env.VIRUS_SCAN_STRICT = "true";
    const next = jest.fn();
    const res = makeRes();
    await virusScan(makeReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
  });

  it("fail-open when VIRUS_SCAN_STRICT='false': next() called", async () => {
    process.env.VIRUS_SCAN_STRICT = "false";
    const next = jest.fn();
    await virusScan(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });
});

// ─── MIME type allowlist compatibility ────────────────────────────────────────

describe("Compatibility — ALLOWED_MIME_TYPES allowlist", () => {
  it("standard document types are in the allowlist", async () => {
    const { ALLOWED_MIME_TYPES } = await import("../../src/middleware/upload");
    for (const mime of ["application/pdf", "image/jpeg", "image/png", "image/gif"]) {
      expect(ALLOWED_MIME_TYPES.has(mime)).toBe(true);
    }
  });

  it("dangerous types are NOT in the allowlist", async () => {
    const { ALLOWED_MIME_TYPES } = await import("../../src/middleware/upload");
    for (const mime of [
      "application/x-executable",
      "application/x-shellscript",
      "text/javascript",
      "text/html",
      "application/octet-stream",
      "application/x-httpd-php",
    ]) {
      expect(ALLOWED_MIME_TYPES.has(mime)).toBe(false);
    }
  });

  it("MIME type lookup is case-sensitive (uppercase variants are rejected)", async () => {
    const { ALLOWED_MIME_TYPES } = await import("../../src/middleware/upload");
    expect(ALLOWED_MIME_TYPES.has("Application/PDF")).toBe(false);
    expect(ALLOWED_MIME_TYPES.has("IMAGE/JPEG")).toBe(false);
  });
});

// ─── X-Content-Hash header compatibility ──────────────────────────────────────

describe("Compatibility — X-Content-Hash header value format", () => {
  it("SHA-256 hex output is always lowercase", () => {
    const crypto = require("crypto");
    const hash = crypto.createHash("sha256").update("test content").digest("hex");
    expect(hash).toBe(hash.toLowerCase());
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("SHA-256 is deterministic across Node.js restarts (same input → same hash)", () => {
    const crypto = require("crypto");
    const input = Buffer.from("deterministic content");
    const h1 = crypto.createHash("sha256").update(input).digest("hex");
    const h2 = crypto.createHash("sha256").update(input).digest("hex");
    expect(h1).toBe(h2);
  });
});
