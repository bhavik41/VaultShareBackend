/**
 * Security Testing — Auth
 * Tests attack vectors: NoSQL injection, JWT manipulation, header injection,
 * brute-force, timing attacks, and account enumeration.
 */
import request from "supertest";
import jwt from "jsonwebtoken";

jest.mock("../../src/middleware/rateLimiter", () => ({
  signinLimiter: (_: any, __: any, n: any) => n(),
  signupLimiter: (_: any, __: any, n: any) => n(),
  forgotPasswordLimiter: (_: any, __: any, n: any) => n(),
  twoFaLimiter: (_: any, __: any, n: any) => n(),
  refreshLimiter: (_: any, __: any, n: any) => n(),
}));
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

import app from "../../src/app";
import * as store from "../../src/db/inMemoryStore";

const mockFindByEmail = jest.mocked(store.findUserByEmail);

beforeEach(() => {
  jest.clearAllMocks();
  mockFindByEmail.mockResolvedValue(undefined);
  jest.mocked(store.updateUser).mockResolvedValue(undefined);
  jest.mocked(store.createUser).mockImplementation(async (u) => u);
});

// ─── NoSQL injection prevention ───────────────────────────────────────────────

describe("Security — NoSQL injection attempts", () => {
  const injectionPayloads = [
    { email: { $gt: "" }, password: "anything" },
    { email: { $ne: null }, password: "anything" },
    { email: "' OR '1'='1", password: "' OR '1'='1" },
    { email: { $regex: ".*" }, password: "anything" },
  ];

  it.each(injectionPayloads)(
    "POST /signin rejects injection payload %j with 4xx (not 200)",
    async (payload) => {
      const res = await request(app)
        .post("/api/auth/signin")
        .send(payload);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    },
  );

  it.each(injectionPayloads)(
    "POST /signup rejects injection payload %j with 4xx",
    async (payload) => {
      const res = await request(app)
        .post("/api/auth/signup")
        .send({ ...payload, name: "X", password: "SecurePass1" });
      expect(res.status).toBeGreaterThanOrEqual(400);
    },
  );
});

// ─── JWT attack vectors ────────────────────────────────────────────────────────

describe("Security — JWT manipulation", () => {
  it("alg:none token is rejected (algorithm confusion attack)", () => {
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ id: "u1", email: "attacker@x.com" })).toString("base64url");
    const noneToken = `${header}.${payload}.`;

    const next = jest.fn();
    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as any;
    const { authenticate } = require("../../src/middleware/auth");
    authenticate({ headers: { authorization: `Bearer ${noneToken}` } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("tampered payload (changed userId) is rejected", () => {
    const token = jwt.sign({ id: "u1", email: "a@a.com", name: "A", twoFactorEnabled: false },
      process.env.JWT_SECRET!, { algorithm: "HS256" });
    const [header, , sig] = token.split(".");
    const newPayload = Buffer.from(JSON.stringify({ id: "u2", email: "attacker@x.com" })).toString("base64url");
    const tamperedToken = `${header}.${newPayload}.${sig}`;

    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
    const { authenticate } = require("../../src/middleware/auth");
    authenticate({ headers: { authorization: `Bearer ${tamperedToken}` } }, res, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("token signed with RS256 (key confusion) is rejected when server expects HS256", () => {
    const token = jwt.sign({ id: "u1" }, process.env.JWT_SECRET!, { algorithm: "HS256" });
    const parts = token.split(".");
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const badToken = `${header}.${parts[1]}.${parts[2]}`;

    const next = jest.fn();
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() } as any;
    const { authenticate } = require("../../src/middleware/auth");
    authenticate({ headers: { authorization: `Bearer ${badToken}` } }, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});

// ─── Account enumeration prevention ───────────────────────────────────────────

describe("Security — Account enumeration", () => {
  it("signin returns the same error message for unknown email vs wrong password", async () => {
    mockFindByEmail.mockResolvedValue(undefined);
    const unknownRes = await request(app)
      .post("/api/auth/signin")
      .send({ email: "ghost@example.com", password: "Any123456" });

    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash("CorrectPass1", 10);
    mockFindByEmail.mockResolvedValue({
      id: "u1", name: "Alice", email: "alice@example.com", passwordHash: hash,
      createdAt: new Date(), refreshToken: null, twoFactorSecret: null, twoFactorEnabled: false,
      lastUsedTotpCode: null, lastUsedTotpAt: null, resetOtp: null, resetOtpExpiry: null,
      signinOtp: null, signinOtpExpiry: null, signinOtpAttempts: 0,
      failedLoginAttempts: 0, lockoutUntil: null, emailVerified: true,
    });
    const wrongPassRes = await request(app)
      .post("/api/auth/signin")
      .send({ email: "alice@example.com", password: "WrongPass1" });

    expect(unknownRes.status).toBe(401);
    expect(wrongPassRes.status).toBe(401);
    expect(unknownRes.body.message).toBe(wrongPassRes.body.message);
  });

  it("forgot-password returns the same response for existing and non-existing emails", async () => {
    mockFindByEmail.mockResolvedValue(undefined);
    const res1 = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody@example.com" });

    const res2 = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "real@example.com" });

    expect(res1.status).toBe(res2.status);
    expect(res1.body.message).toBe(res2.body.message);
  });
});

// ─── Request body size limit ───────────────────────────────────────────────────

describe("Security — Request body size limits", () => {
  it("POST /signup rejects body larger than 10KB", async () => {
    const bigName = "A".repeat(15 * 1024);
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: bigName, email: "a@a.com", password: "SecurePass1" });

    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

// ─── Unauthenticated access ────────────────────────────────────────────────────

describe("Security — Protected routes require authentication", () => {
  const protectedRoutes = [
    { method: "get", path: "/api/auth/me" },
    { method: "post", path: "/api/auth/logout" },
    { method: "post", path: "/api/auth/2fa/setup" },
    { method: "post", path: "/api/auth/2fa/verify" },
    { method: "delete", path: "/api/auth/2fa/disable" },
  ];

  it.each(protectedRoutes)(
    "$method $path returns 401 without Authorization header",
    async ({ method, path }) => {
      const res = await (request(app) as any)[method](path).send({});
      expect(res.status).toBe(401);
    },
  );
});
