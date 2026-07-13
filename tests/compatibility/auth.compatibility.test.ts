/**
 * Compatibility Testing — Auth
 * Verifies that auth works correctly across different environment configurations:
 * custom secrets, algorithm constraints, and edge-case token formats.
 */
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

jest.mock("../../src/db/inMemoryStore", () => ({
  findUserByEmail: jest.fn(),
  findUserById: jest.fn(),
  findUserByRefreshTokenHash: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
}));
jest.mock("../../src/utils/email", () => ({
  sendSigninOtpEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

import * as store from "../../src/db/inMemoryStore";
import { authenticate } from "../../src/middleware/auth";
import type { Request, Response, NextFunction } from "express";

const mockFindById = jest.mocked(store.findUserById);

function makeReq(authHeader?: string): Request {
  return { headers: { authorization: authHeader } } as unknown as Request;
}
function makeRes() {
  return { status: jest.fn().mockReturnThis(), json: jest.fn() } as unknown as Response & { status: jest.Mock; json: jest.Mock };
}

beforeEach(() => jest.clearAllMocks());

// ─── JWT algorithm constraint ──────────────────────────────────────────────────

describe("Compatibility — JWT algorithm must be HS256", () => {
  it("HS256 token is accepted by the authenticate middleware", () => {
    const token = jwt.sign({ id: "u1", email: "a@a.com", name: "A", twoFactorEnabled: false },
      process.env.JWT_SECRET!, { algorithm: "HS256" });
    const next = jest.fn();
    const req = makeReq(`Bearer ${token}`);
    authenticate(req, makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("a token signed with HS384 is rejected (alg constraint)", () => {
    const hs384Token = jwt.sign({ id: "u1" }, process.env.JWT_SECRET!, { algorithm: "HS384" } as any);
    const next = jest.fn();
    const res = makeRes();
    authenticate(makeReq(`Bearer ${hs384Token}`), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("a token signed with a different secret is rejected", () => {
    const token = jwt.sign({ id: "u1" }, "wrong-secret", { algorithm: "HS256" });
    const next = jest.fn();
    const res = makeRes();
    authenticate(makeReq(`Bearer ${token}`), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ─── Token expiry ──────────────────────────────────────────────────────────────

describe("Compatibility — JWT expiry handling", () => {
  it("an unexpired token is accepted", () => {
    const token = jwt.sign({ id: "u1", email: "a@a.com", name: "A", twoFactorEnabled: false },
      process.env.JWT_SECRET!, { algorithm: "HS256", expiresIn: "1h" });
    const next = jest.fn();
    authenticate(makeReq(`Bearer ${token}`), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("an expired token is rejected with 401", () => {
    const token = jwt.sign({ id: "u1" }, process.env.JWT_SECRET!,
      { algorithm: "HS256", expiresIn: "-1s" });
    const next = jest.fn();
    const res = makeRes();
    authenticate(makeReq(`Bearer ${token}`), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ─── Authorization header format ──────────────────────────────────────────────

describe("Compatibility — Authorization header formats", () => {
  it("Bearer token with correct prefix is accepted", () => {
    const token = jwt.sign({ id: "u1", email: "a@a.com", name: "A", twoFactorEnabled: false },
      process.env.JWT_SECRET!, { algorithm: "HS256" });
    const next = jest.fn();
    authenticate(makeReq(`Bearer ${token}`), makeRes(), next);
    expect(next).toHaveBeenCalled();
  });

  it("lowercase 'bearer' prefix is rejected", () => {
    const token = jwt.sign({ id: "u1" }, process.env.JWT_SECRET!, { algorithm: "HS256" });
    const next = jest.fn();
    const res = makeRes();
    authenticate(makeReq(`bearer ${token}`), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("token without Bearer prefix is rejected", () => {
    const token = jwt.sign({ id: "u1" }, process.env.JWT_SECRET!, { algorithm: "HS256" });
    const next = jest.fn();
    const res = makeRes();
    authenticate(makeReq(token), res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it("missing Authorization header returns 401", () => {
    const next = jest.fn();
    const res = makeRes();
    authenticate(makeReq(), res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ─── Environment: different secrets ───────────────────────────────────────────

describe("Compatibility — TEMP_SECRET usage", () => {
  it("temp token signed with TEMP_SECRET is verifiable", () => {
    const tempToken = jwt.sign({ userId: "u1", purpose: "signin-otp" }, process.env.TEMP_SECRET!, { expiresIn: "10m" });
    const decoded = jwt.verify(tempToken, process.env.TEMP_SECRET!) as any;
    expect(decoded.userId).toBe("u1");
    expect(decoded.purpose).toBe("signin-otp");
  });

  it("temp token signed with REFRESH_SECRET is NOT verifiable with TEMP_SECRET", () => {
    const wrongToken = jwt.sign({ userId: "u1" }, process.env.REFRESH_SECRET!);
    expect(() => jwt.verify(wrongToken, process.env.TEMP_SECRET!)).toThrow();
  });
});

// ─── bcrypt cost factor compatibility ─────────────────────────────────────────

describe("Compatibility — bcrypt cost factor 10", () => {
  it("hash generated at cost 10 is verifiable", async () => {
    const hash = await bcrypt.hash("MyPassword123", 10);
    expect(await bcrypt.compare("MyPassword123", hash)).toBe(true);
    expect(await bcrypt.compare("WrongPassword", hash)).toBe(false);
  });

  it("bcrypt hash from cost 10 starts with $2a$10$ or $2b$10$", async () => {
    const hash = await bcrypt.hash("pass", 10);
    expect(hash).toMatch(/^\$2[ab]\$10\$/);
  });
});
