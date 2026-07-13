/**
 * Integration — Auth
 * Tests the full auth service chain with real bcrypt, real JWT, and real TOTP.
 * Only the DB and email layers are mocked.
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import speakeasy from "speakeasy";

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

import * as store from "../../src/db/inMemoryStore";
import * as authService from "../../src/services/auth.service";

const mockFindByEmail = jest.mocked(store.findUserByEmail);
const mockFindById = jest.mocked(store.findUserById);
const mockCreateUser = jest.mocked(store.createUser);
const mockUpdateUser = jest.mocked(store.updateUser);
const mockFindByHash = jest.mocked(store.findUserByRefreshTokenHash);

function baseUser(overrides: Partial<store.StoredUser> = {}): store.StoredUser {
  return {
    id: "u1",
    name: "Alice",
    email: "alice@example.com",
    passwordHash: "",
    createdAt: new Date(),
    refreshToken: null,
    twoFactorSecret: null,
    twoFactorEnabled: false,
    lastUsedTotpCode: null,
    lastUsedTotpAt: null,
    resetOtp: null,
    resetOtpExpiry: null,
    signinOtp: null,
    signinOtpExpiry: null,
    signinOtpAttempts: 0,
    failedLoginAttempts: 0,
    lockoutUntil: null,
    emailVerified: true,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateUser.mockResolvedValue(undefined);
});

// ─── Signup → real bcrypt hash stored ────────────────────────────────────────

describe("Auth Integration — signup stores real bcrypt hash", () => {
  it("calls createUser with a bcrypt hash, not plaintext password", async () => {
    mockFindByEmail.mockResolvedValue(undefined);
    let captured: any;
    mockCreateUser.mockImplementation(async (u) => { captured = u; return u; });

    await authService.signup({ name: "Alice", email: "alice@example.com", password: "SecurePass1" });

    expect(captured.passwordHash).not.toBe("SecurePass1");
    const valid = await bcrypt.compare("SecurePass1", captured.passwordHash);
    expect(valid).toBe(true);
  });

  it("stored hash is not reused across two signups with the same password", async () => {
    mockFindByEmail.mockResolvedValue(undefined);
    const hashes: string[] = [];
    mockCreateUser.mockImplementation(async (u) => { hashes.push(u.passwordHash); return u; });

    await authService.signup({ name: "A", email: "a@a.com", password: "SamePass1" });
    mockFindByEmail.mockResolvedValue(undefined);
    await authService.signup({ name: "B", email: "b@b.com", password: "SamePass1" });

    expect(hashes[0]).not.toBe(hashes[1]);
  });
});

// ─── Signin → real bcrypt comparison ─────────────────────────────────────────

describe("Auth Integration — signin uses real bcrypt comparison", () => {
  it("accepts the correct password after real bcrypt hash", async () => {
    const hash = await bcrypt.hash("MyPassword1", 10);
    mockFindByEmail.mockResolvedValue(baseUser({ passwordHash: hash, emailVerified: true }));
    mockUpdateUser.mockResolvedValue(undefined);

    const result = await authService.signin({ email: "alice@example.com", password: "MyPassword1" });
    expect(result.requiresOtp).toBe(true);
    expect(result.tempToken).toBeTruthy();
  });

  it("rejects a wrong password (real bcrypt check)", async () => {
    const hash = await bcrypt.hash("CorrectPassword1", 10);
    mockFindByEmail.mockResolvedValue(baseUser({ passwordHash: hash }));
    mockUpdateUser.mockResolvedValue(undefined);

    await expect(
      authService.signin({ email: "alice@example.com", password: "WrongPassword1" }),
    ).rejects.toThrow();
  });
});

// ─── verifySigninOtp → real JWT issued ───────────────────────────────────────

describe("Auth Integration — verifySigninOtp issues real JWT", () => {
  it("access token is verifiable with the JWT_SECRET", async () => {
    const otp = "123456";
    const hash = await bcrypt.hash(otp, 10);
    const user = baseUser({ signinOtp: hash, signinOtpExpiry: new Date(Date.now() + 60_000) });
    mockFindById.mockResolvedValue(user);
    mockUpdateUser.mockResolvedValue(undefined);

    const tempToken = jwt.sign(
      { id: "u1", requiresEmailOtp: true },
      process.env.TEMP_SECRET!,
      { expiresIn: "10m" },
    );
    const result = await authService.verifySigninOtp(tempToken, otp);

    const decoded = jwt.verify(result.accessToken, process.env.JWT_SECRET!) as any;
    expect(decoded.id).toBe("u1");
  });

  it("refresh token is stored as SHA-256 hash, not plaintext JWT", async () => {
    const otp = "654321";
    const hash = await bcrypt.hash(otp, 10);
    const user = baseUser({ signinOtp: hash, signinOtpExpiry: new Date(Date.now() + 60_000) });
    mockFindById.mockResolvedValue(user);
    let stored: any;
    mockUpdateUser.mockImplementation(async (_id, patch) => { stored = patch; return undefined; });

    const tempToken = jwt.sign(
      { id: "u1", requiresEmailOtp: true },
      process.env.TEMP_SECRET!,
      { expiresIn: "10m" },
    );
    const result = await authService.verifySigninOtp(tempToken, otp);

    expect(stored.refreshToken).not.toBe(result.refreshToken);
    expect(stored.refreshToken).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── refresh → rotation chain ─────────────────────────────────────────────────

describe("Auth Integration — refresh token rotation chain", () => {
  it("new refresh token hash replaces the old one in DB", async () => {
    const crypto = await import("crypto");
    const oldToken = jwt.sign({ id: "u1" }, process.env.REFRESH_SECRET!, { expiresIn: "7d" });
    const oldHash = crypto.createHash("sha256").update(oldToken).digest("hex");

    mockFindByHash.mockResolvedValue(baseUser({ refreshToken: oldHash }));
    let updatedHash: string | null | undefined;
    mockUpdateUser.mockImplementation(async (_id, patch) => { updatedHash = patch.refreshToken; return undefined; });

    const result = await authService.refresh(oldToken);

    expect(updatedHash).not.toBe(oldHash);
    expect(updatedHash).toMatch(/^[0-9a-f]{64}$/i);
    const newDecoded = jwt.verify(result.newAccessToken, process.env.JWT_SECRET!) as any;
    expect(newDecoded.id).toBe("u1");
  });
});

// ─── TOTP integration — real speakeasy ────────────────────────────────────────

describe("Auth Integration — 2FA with real TOTP codes", () => {
  it("validate2fa accepts a live TOTP code", async () => {
    const secret = speakeasy.generateSecret({ length: 20 }).base32;
    const liveCode = speakeasy.totp({ secret, encoding: "base32" });

    const user = baseUser({ twoFactorEnabled: true, twoFactorSecret: secret });
    mockFindById.mockResolvedValue(user);
    mockUpdateUser.mockResolvedValue(undefined);

    const tempToken = jwt.sign(
      { id: "u1", requires2fa: true },
      process.env.TEMP_SECRET!,
      { expiresIn: "10m" },
    );

    const result = await authService.validate2fa(tempToken, liveCode);
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
  });

  it("validate2fa rejects a stale replay of the same TOTP code", async () => {
    const secret = speakeasy.generateSecret({ length: 20 }).base32;
    const code = speakeasy.totp({ secret, encoding: "base32" });

    const user = baseUser({
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      lastUsedTotpCode: code,
      lastUsedTotpAt: new Date(),
    });
    mockFindById.mockResolvedValue(user);
    mockUpdateUser.mockResolvedValue(undefined);

    const tempToken = jwt.sign(
      { id: "u1", requires2fa: true },
      process.env.TEMP_SECRET!,
      { expiresIn: "10m" },
    );

    await expect(authService.validate2fa(tempToken, code)).rejects.toThrow();
  });
});
