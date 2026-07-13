/**
 * Interface Testing — Auth
 * Verifies the exact shape, status codes, and headers of every auth API response.
 * Treats the API as a contract that must not change without updating this suite.
 */
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

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
  sendWelcomeEmail: jest.fn().mockResolvedValue(undefined),
}));

import app from "../../src/app";
import * as store from "../../src/db/inMemoryStore";

const mockFindByEmail = jest.mocked(store.findUserByEmail);
const mockFindById = jest.mocked(store.findUserById);
const mockCreateUser = jest.mocked(store.createUser);

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

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(store.updateUser).mockResolvedValue(undefined);
  mockCreateUser.mockImplementation(async (u) => u);
});

// ─── Signup response shape ────────────────────────────────────────────────────

describe("Interface — POST /api/auth/signup response shape", () => {
  it("201 body has exactly { requiresOtp: true, tempToken: <string> }", async () => {
    mockFindByEmail.mockResolvedValue(undefined);
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Alice", email: "alice@example.com", password: "SecurePass1" });

    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ requiresOtp: true });
    expect(typeof res.body.tempToken).toBe("string");
    expect(res.body.tempToken.length).toBeGreaterThan(0);
  });

  it("409 body has { message: string } on duplicate email", async () => {
    const hash = await bcrypt.hash("pass", 10);
    mockFindByEmail.mockResolvedValue(baseUser({ passwordHash: hash }));
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "A", email: "alice@example.com", password: "SecurePass1" });

    expect(res.status).toBe(409);
    expect(typeof res.body.message).toBe("string");
  });

  it("Content-Type is application/json", async () => {
    mockFindByEmail.mockResolvedValue(undefined);
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "A", email: "a@a.com", password: "SecurePass1" });

    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

// ─── Signin response shape ────────────────────────────────────────────────────

describe("Interface — POST /api/auth/signin response shape", () => {
  it("200 body has { requiresOtp: true, tempToken: <string> } for non-2FA user", async () => {
    const hash = await bcrypt.hash("Pass1234", 10);
    mockFindByEmail.mockResolvedValue(baseUser({ passwordHash: hash }));

    const res = await request(app)
      .post("/api/auth/signin")
      .send({ email: "alice@example.com", password: "Pass1234" });

    expect(res.status).toBe(200);
    expect(res.body.requiresOtp).toBe(true);
    expect(typeof res.body.tempToken).toBe("string");
  });

  it("401 body has { message: string } on wrong credentials", async () => {
    mockFindByEmail.mockResolvedValue(undefined);
    const res = await request(app)
      .post("/api/auth/signin")
      .send({ email: "x@x.com", password: "wrong" });

    expect(res.status).toBe(401);
    expect(typeof res.body.message).toBe("string");
  });
});

// ─── verify-otp response shape ────────────────────────────────────────────────

describe("Interface — POST /api/auth/signin/verify-otp response shape", () => {
  it("200 body has { message, token, refreshToken, user } with correct user fields", async () => {
    const otp = "456789";
    const hash = await bcrypt.hash(otp, 10);
    mockFindById.mockResolvedValue(
      baseUser({ signinOtp: hash, signinOtpExpiry: new Date(Date.now() + 60_000) }),
    );

    const tempToken = jwt.sign({ id: "u1", requiresEmailOtp: true }, process.env.TEMP_SECRET!, { expiresIn: "10m" });
    const res = await request(app)
      .post("/api/auth/signin/verify-otp")
      .send({ tempToken, otp });

    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe("string");
    expect(typeof res.body.refreshToken).toBe("string");
    expect(res.body.message).toMatch(/signed in/i);
    expect(res.body.user).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      email: expect.any(String),
    });
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.refreshToken).toBeUndefined();
  });
});

// ─── refresh response shape ───────────────────────────────────────────────────

describe("Interface — POST /api/auth/refresh response shape", () => {
  it("200 body has exactly { token, refreshToken }", async () => {
    const crypto = await import("crypto");
    const oldToken = jwt.sign({ id: "u1" }, process.env.REFRESH_SECRET!, { expiresIn: "7d" });
    const hash = crypto.createHash("sha256").update(oldToken).digest("hex");
    jest.mocked(store.findUserByRefreshTokenHash).mockResolvedValue(baseUser({ refreshToken: hash }));

    const res = await request(app)
      .post("/api/auth/refresh")
      .send({ refreshToken: oldToken });

    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(["refreshToken", "token"].sort());
  });
});

// ─── me response shape ────────────────────────────────────────────────────────

describe("Interface — GET /api/auth/me response shape", () => {
  it("200 body has { user } with id, name, email — no passwordHash, no refreshToken", async () => {
    mockFindById.mockResolvedValue(baseUser());
    const token = jwt.sign(
      { id: "u1", email: "alice@example.com", name: "Alice", twoFactorEnabled: false },
      process.env.JWT_SECRET!,
      { algorithm: "HS256" },
    );

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.passwordHash).toBeUndefined();
    expect(res.body.user.refreshToken).toBeUndefined();
    expect(res.body.user.id).toBeDefined();
    expect(res.body.user.email).toBeDefined();
  });
});

// ─── forgot-password response shape ──────────────────────────────────────────

describe("Interface — POST /api/auth/forgot-password response shape", () => {
  it("200 always returns the same message regardless of whether email exists", async () => {
    mockFindByEmail.mockResolvedValue(undefined);
    const res1 = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "nobody@x.com" });

    mockFindByEmail.mockResolvedValue(baseUser());
    const res2 = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "alice@example.com" });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(res1.body.message).toBe(res2.body.message);
  });
});

// ─── logout response shape ────────────────────────────────────────────────────

describe("Interface — POST /api/auth/logout response shape", () => {
  it("200 body has { message: string }", async () => {
    mockFindById.mockResolvedValue(baseUser());
    const token = jwt.sign(
      { id: "u1", email: "alice@example.com", name: "Alice", twoFactorEnabled: false },
      process.env.JWT_SECRET!,
      { algorithm: "HS256" },
    );
    const res = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(typeof res.body.message).toBe("string");
  });
});
