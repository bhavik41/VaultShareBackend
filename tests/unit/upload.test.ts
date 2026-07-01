import type { Request, Response, NextFunction } from "express";
import { fileFilter, MAX_FILE_SIZE_BYTES, validateMagicBytes } from "../../src/middleware/upload";

function multerFile(overrides: Partial<Express.Multer.File>): Express.Multer.File {
  return {
    fieldname: "file",
    originalname: "test-file",
    encoding: "7bit",
    mimetype: "application/pdf",
    size: 0,
    destination: "",
    filename: "",
    path: "",
    buffer: Buffer.alloc(0),
    stream: undefined as never,
    ...overrides,
  };
}

function mockResponse() {
  const res = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
  return res as unknown as Response & { status: jest.Mock; json: jest.Mock };
}

describe("upload fileFilter", () => {
  it("accepts allowed MIME types such as application/pdf", () => {
    const cb = jest.fn();

    fileFilter({} as Request, multerFile({ mimetype: "application/pdf" }), cb);

    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it("blocks text/javascript", () => {
    const cb = jest.fn();

    fileFilter({} as Request, multerFile({ mimetype: "text/javascript" }), cb);

    expect(cb).toHaveBeenCalledWith(expect.any(Error));
    expect(cb.mock.calls[0][0].message).toContain('File type "text/javascript" is not allowed');
  });

  it("blocks text/html", () => {
    const cb = jest.fn();

    fileFilter({} as Request, multerFile({ mimetype: "text/html" }), cb);

    expect(cb).toHaveBeenCalledWith(expect.any(Error));
    expect(cb.mock.calls[0][0].message).toContain('File type "text/html" is not allowed');
  });

  it("blocks application/octet-stream", () => {
    const cb = jest.fn();

    fileFilter({} as Request, multerFile({ mimetype: "application/octet-stream" }), cb);

    expect(cb).toHaveBeenCalledWith(expect.any(Error));
    expect(cb.mock.calls[0][0].message).toContain(
      'File type "application/octet-stream" is not allowed',
    );
  });

  it("configures a 50MB file size limit by default", () => {
    expect(MAX_FILE_SIZE_BYTES).toBe(50 * 1024 * 1024);
  });
});

describe("validateMagicBytes", () => {
  it("allows a PDF whose content matches its declared MIME type", () => {
    const buffer = Buffer.from("%PDF-1.7\ncontent");
    const req = { file: multerFile({ buffer, mimetype: "application/pdf" }) } as Request;
    const res = mockResponse();
    const next: NextFunction = jest.fn();

    validateMagicBytes(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("rejects a spoofed PDF whose bytes do not match the declared MIME type", () => {
    const buffer = Buffer.from("<script>alert(1)</script>");
    const req = { file: multerFile({ buffer, mimetype: "application/pdf" }) } as Request;
    const res = mockResponse();
    const next: NextFunction = jest.fn();

    validateMagicBytes(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      message: 'File content does not match declared type "application/pdf". Upload rejected.',
    });
  });
});
