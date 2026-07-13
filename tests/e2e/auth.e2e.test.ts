/**
 * E2E — Auth
 * Full HTTP stack via supertest: request → middleware → controller → service → (mocked DB)
 * Rate limiters are bypassed so the suite runs without hitting IP windows.
 */
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

jest.mock("../../src/middleware/rateLimiter", () => ({
  signinLimiter: (_: any, __: any, next: any) => next(),
  signupLimiter: (_: any, __: any, next: any) => next(),
  forgotPasswordLimiter: (_: any, __: any, next: any) => next(),
  twoFaLimiter: (_: any, __: any, next: any) => next(),
  refreshLimiter: (_: any, __: any, next: any) => next(),
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
  sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
}));

import app from "../../src/app";
import * as store from "../../src/db/inMemoryStore";

const mockFindByEmail = jest.mocked(store.findUserByEmail);
const mockFindById = jest.mocked(store.findUserById);
const mockCreateUser = jest.mocked(store.createUser);
const mockUpdateUser = jest.mocked(store.updateUser);
const mockFindByHash = jest.mocked(store.findUserByRefreshTokenHash);

function baseUser(o: Partial<store.StoredUser> = {}): store.StoredUser {
  return {
    id: "u1", name: "Alice", email: "alice@example.com",
    passwordHash: "", createdAt: new Date(), refreshToken: null,
    twoFactorSecret: null, twoFactorEnabled: false,
    lastUsedTotpCode: null, lastUsedTotpAt: null,
    resetOtp: null, resetOtpExpiry: null,
    signinOtp: null, signinOtpExpiry: null, signinOtpAttempts: 0,
    failedLoginAttempts: 0, lockoutUntil: null, emailVerified: true, ...o,
  };
}

function bearerToken(userId = "u1"): string {
  return jwt.sign(
    { id: userId, email: "alice@example.com", name: "Alice", twoFactorEnabled: false },
    process.env.JWT_SECRET!,
    { algorithm: "HS256", expiresIn: "1h" },
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateUser.mockResolvedValue(undefined);
  mockCreateUser.mockImplementation(async (u) => u);
});

// ─── POST /api/auth/signup ────────────────────────────────────────────────────

describe("E2E POST /api/auth/signup", () => {
  it("201 + requiresOtp for a new user", async () => {
    mockFindByEmail.mockResolvedValue(undefined);
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Alice", email: "alice@example.com", password: "SecurePass1" });

    expect(res.status).toBe(201);
    expect(res.body.requiresOtp).toBe(true);
    expect(res.body.tempToken).toBeTruthy();
  });

  it("400 when name is missing", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "alice@example.com", password: "SecurePass1" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });

  it("409 when email is already taken", async () => {
    const hash = await bcrypt.hash("Existing1", 10);
    mockFindByEmail.mockResolvedValue(baseUser({ passwordHash: hash, emailVerified: true }));

    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Alice", email: "alice@example.com", password: "SecurePass1" });

    expect(res.status).toBe(409);
  });

  it("400 for a weak password (< 8 chars)", async () => {
    mockFindByEmail.mockResolvedValue(undefined);
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Alice", email: "alice@example.com", password: "short" });

    expect(res.status).toBe(400);
  });
});

// ─── POST /api/auth/signin ────────────────────────────────────────────────────

describe("E2E POST /api/auth/signin", () => {
  it("200 + requiresOtp for correct credentials", async () => {
    const hash = await bcrypt.hash("CorrectPass1", 10);
    mockFindByEmail.mockResolvedValue(baseUser({ passwordHash: hash }));

    const res = await request(app)
      .post("/api/auth/signin")
      .send({ email: "alice@example.com", password: "CorrectPass1" });

    expect(res.status).toBe(200);
    expect(res.body.requiresOtp).toBe(true);
    expect(res.body.tempToken).toBeTruthy();
  });

  it("401 for wrong password", async () => {
    const hash = await bcrypt.hash("CorrectPass1", 10);
    mockFindByEmail.mockResolvedValue(baseUser({ passwordHash: hash }));

    const res = await request(app)
      .post("/api/auth/signin")
      .send({ email: "alice@example.com", password: "WrongPass1" });

    expect(res.status).toBe(401);
  });

  it("400 when email field is omitted", async () => {
    const res = await request(app)
      .post("/api/auth/signin")
      .send({ password: "SomePass1" });

    expect(res.status).toBe(400);
  });

  it("401 for unknown email — same message as wrong password (no enumeration)", async () => {
    mockFindByEmail.mockResolvedValue(undefined);
    const res1 = await request(app)
      .post("/api/auth/signin")
      .send({ email: "nobody@example.com", password: "AnyPass1" });

    const hash = await bcrypt.hash("RealPass1", 10);
    mockFindByEmail.mockResolvedValue(baseUser({ passwordHash: hash }));
    const res2 = await request(app)
      .post("/api/auth/signin")
      .send({ email: "alice@example.com", password: "WrongPass1" });

    expect(res1.body.message).toBe(res2.body.message);
  });
});

// ─── POST /api/auth/signin/verify-otp ────────────────────────────────────────

describe("E2E POST /api/auth/signin/verify-otp", () => {
  it("200 + tokens for a correct OTP", async () => {
    const otp = "112233";
    const hash = await bcrypt.hash(otp, 10);
    mockFindById.mockResolvedValue(
      baseUser({ signinOtp: hash, signinOtpExpiry: new Date(Date.now() + 60_000) }),
    );

    const tempToken = jwt.sign({ id: "u1", requiresEmailOtp: true }, process.env.TEMP_SECRET!, { expiresIn: "10m" });
    const res = await request(app)
      .post("/api/auth/signin/verify-otp")
      .send({ tempToken, otp });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
  });

  it("401 for an expired OTP", async () => {
    const otp = "999888";
    const hash = await bcrypt.hash(otp, 10);
    mockFindById.mockResolvedValue(
      baseUser({ signinOtp: hash, signinOtpExpiry: new Date(Date.now() - 1000) }),
    );

    const tempToken = jwt.sign({ id: "u1", requiresEmailOtp: true }, process.env.TEMP_SECRET!, { expiresIn: "10m" });
    const res = await request(app)
      .post("/api/auth/signin/verify-otp")
      .send({ tempToken, otp });

    expect(res.status).toBe(401);
  });

  it("400 when tempToken is missing", async () => {
    const res = await request(app)
      .post("/api/auth/signin/verify-otp")
      .send({ otp: "123456" });

    expect(res.status).toBe(400);
  });
});

// ─── POST /api/auth/refresh ───────────────────────────────────────────────────

describe("E2E POST /api/auth/refresh", () => {
  it("200 + new tokens for a valid refresh token", async () => {
    const crypto = await import("crypto");
    const oldToken = jwt.sign({ id: "u1" }, process.env.REFRESH_SECRET!, { expiresIn: "7d" });
    const hash = crypto.createHash("sha256").update(oldToken).digest("hex");
    mockFindByHash.mockResolvedValue(baseUser({ refreshToken: hash }));

    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: oldToken });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
  });

  it("401 for a tampered refresh token", async () => {
    mockFindByHash.mockResolvedValue(undefined);
    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: "tampered.token.here" });

    expect(res.status).toBe(401);
  });
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────

describe("E2E GET /api/auth/me", () => {
  it("200 + user info for authenticated request", async () => {
    mockFindById.mockResolvedValue(baseUser());

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${bearerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("alice@example.com");
  });

  it("401 with no Authorization header", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });
});

// ─── POST /api/auth/logout ────────────────────────────────────────────────────

describe("E2E POST /api/auth/logout", () => {
  it("200 on successful logout", async () => {
    mockFindById.mockResolvedValue(baseUser());
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${bearerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/logged out/i);
  });
});

// ─── POST /api/auth/forgot-password ──────────────────────────────────────────

describe("E2E POST /api/auth/forgot-password", () => {
  it("200 for any email — doesn't reveal whether email exists", async () => {
    mockFindByEmail.mockResolvedValue(undefined);
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/OTP/i);
  });
});
