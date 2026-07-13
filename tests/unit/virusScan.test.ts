import fs from "fs";
import type { Request, Response, NextFunction } from "express";

// jest.mock is hoisted — child_process is mocked before virusScan imports it
jest.mock("child_process", () => ({
  exec: jest.fn(),
}));

import { exec } from "child_process";
const mockExec = exec as unknown as jest.Mock;

import { virusScan } from "../../src/middleware/virusScan";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeReq(fileOverrides?: Partial<Express.Multer.File> | null): Request {
  const file =
    fileOverrides === null
      ? undefined
      : ({
          fieldname: "file",
          originalname: "test.pdf",
          encoding: "7bit",
          mimetype: "application/pdf",
          size: 1024,
          buffer: Buffer.from("%PDF-1.7 test content"),
          destination: "",
          filename: "",
          path: "",
          stream: undefined as never,
          ...fileOverrides,
        } as Express.Multer.File);
  return { file } as unknown as Request;
}

function makeRes() {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as Response & { status: jest.Mock; json: jest.Mock };
}

// ClamAV exit-code helpers
function cleanExit(cmd: string, cb: Function) { cb(null, "OK", ""); }
function virusExit(cmd: string, cb: Function) { cb(Object.assign(new Error("FOUND"), { code: 1 })); }
function errorExit(cmd: string, cb: Function) { cb(Object.assign(new Error("scan error"), { code: 2 })); }

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.ENABLE_VIRUS_SCAN;
  delete process.env.VIRUS_SCAN_STRICT;

  jest.spyOn(fs, "writeFileSync").mockImplementation(() => {});
  jest.spyOn(fs, "unlink").mockImplementation((_p: any, cb: any) => cb(null));

  mockExec.mockImplementation(cleanExit);
});

// ─── disabled scan ────────────────────────────────────────────────────────────

describe("virusScan — scan disabled", () => {
  it("calls next() immediately when ENABLE_VIRUS_SCAN is not set", async () => {
    const next = jest.fn();
    await virusScan(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("calls next() when ENABLE_VIRUS_SCAN is 'false'", async () => {
    process.env.ENABLE_VIRUS_SCAN = "false";
    const next = jest.fn();
    await virusScan(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(mockExec).not.toHaveBeenCalled();
  });
});

// ─── no file / no buffer (guard clauses) ─────────────────────────────────────

describe("virusScan — file and buffer guards", () => {
  beforeEach(() => { process.env.ENABLE_VIRUS_SCAN = "true"; });

  it("calls next() and skips scan when req.file is absent", async () => {
    const next = jest.fn();
    await virusScan(makeReq(null), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });

  it("calls next() and skips scan when file.buffer is undefined (re-used multer instance)", async () => {
    const next = jest.fn();
    await virusScan(makeReq({ buffer: undefined as any }), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(mockExec).not.toHaveBeenCalled();
  });
});

// ─── scan outcomes ────────────────────────────────────────────────────────────

describe("virusScan — scan outcomes", () => {
  beforeEach(() => { process.env.ENABLE_VIRUS_SCAN = "true"; });

  it("calls next() for a clean file (ClamAV exit 0)", async () => {
    const next = jest.fn();
    mockExec.mockImplementation(cleanExit);
    await virusScan(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
  });

  it("returns 422 when ClamAV detects a virus (exit code 1)", async () => {
    const next = jest.fn();
    const res = makeRes();
    mockExec.mockImplementation(virusExit);
    await virusScan(makeReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({ message: "Malware detected. Upload rejected." });
  });

  it("calls next() (fail open) when ClamAV is unavailable and STRICT is not set", async () => {
    const next = jest.fn();
    mockExec.mockImplementation(errorExit);
    await virusScan(makeReq(), makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when ClamAV is unavailable and VIRUS_SCAN_STRICT=true", async () => {
    process.env.VIRUS_SCAN_STRICT = "true";
    const next = jest.fn();
    const res = makeRes();
    mockExec.mockImplementation(errorExit);
    await virusScan(makeReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ message: "Virus scanner unavailable. Upload rejected." });
  });
});

// ─── temp file cleanup ────────────────────────────────────────────────────────

describe("virusScan — temp file cleanup", () => {
  beforeEach(() => { process.env.ENABLE_VIRUS_SCAN = "true"; });

  it("deletes the temp file after a clean scan", async () => {
    mockExec.mockImplementation(cleanExit);
    await virusScan(makeReq(), makeRes(), jest.fn());
    expect(fs.unlink).toHaveBeenCalledTimes(1);
  });

  it("deletes the temp file even when a virus is detected", async () => {
    mockExec.mockImplementation(virusExit);
    await virusScan(makeReq(), makeRes(), jest.fn());
    expect(fs.unlink).toHaveBeenCalledTimes(1);
  });

  it("deletes the temp file even when ClamAV is unavailable", async () => {
    mockExec.mockImplementation(errorExit);
    await virusScan(makeReq(), makeRes(), jest.fn());
    expect(fs.unlink).toHaveBeenCalledTimes(1);
  });
});
