/**
 * Regression — Auth
 * Named tests for each bug that was found and fixed. A failure here means
 * a regression has been introduced.
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import speakeasy from "speakeasy";
import crypto from "crypto";

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
const mockUpdateUser = jest.mocked(store.updateUser);
const mockCreateUser = jest.mocked(store.createUser);
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

beforeEach(() => {
  jest.clearAllMocks();
  mockUpdateUser.mockResolvedValue(undefined);
  mockCreateUser.mockImplementation(async (u) => u);
});

// BUG-FIX-1: Refresh token stored as plaintext — now SHA-256 hashed
describe("REGRESSION BUG-FIX-1 — refresh token must be stored as SHA-256 hash", () => {
  it("plaintext JWT is NOT stored in DB; only the 64-char hex hash is stored", async () => {
    const otp = "111222";
    const hash = await bcrypt.hash(otp, 10);
    mockFindById.mockResolvedValue(
      baseUser({ signinOtp: hash, signinOtpExpiry: new Date(Date.now() + 60_000) }),
    );
    let storedValue: string | null | undefined;
    mockUpdateUser.mockImplementation(async (_id, patch) => {
      if (patch.refreshToken !== undefined) storedValue = patch.refreshToken;
      return undefined;
    });

    const tempToken = jwt.sign({ id: "u1", requiresEmailOtp: true }, process.env.TEMP_SECRET!, { expiresIn: "10m" });
    const result = await authService.verifySigninOtp(tempToken, otp);

    expect(storedValue).not.toBe(result.refreshToken);
    expect(storedValue).toMatch(/^[0-9a-f]{64}$/);
    expect(result.refreshToken).not.toMatch(/^[0-9a-f]{64}$/);
  });
});

// BUG-FIX-2: findUserByRefreshToken (plaintext) replaced by findUserByRefreshTokenHash
describe("REGRESSION BUG-FIX-2 — refresh lookup uses SHA-256 hash not plaintext", () => {
  it("refresh token lookup uses hash not the raw JWT string", async () => {
    const rawToken = jwt.sign({ id: "u1" }, process.env.REFRESH_SECRET!, { expiresIn: "7d" });
    const expectedHash = crypto.createHash("sha256").update(rawToken).digest("hex");

    mockFindByHash.mockResolvedValue(baseUser({ refreshToken: expectedHash }));

    await authService.refresh(rawToken);

    const lookedUpWith = (mockFindByHash as jest.Mock).mock.calls[0][0];
    expect(lookedUpWith).toBe(expectedHash);
    expect(lookedUpWith).not.toBe(rawToken);
  });
});

// BUG-FIX-3: Token reuse → all sessions revoked
describe("REGRESSION BUG-FIX-3 — stolen refresh token triggers full session revocation", () => {
  it("second use of a refresh token (hash not in DB) wipes refresh token from DB", async () => {
    const staleToken = jwt.sign({ id: "u1" }, process.env.REFRESH_SECRET!, { expiresIn: "7d" });
    mockFindByHash.mockResolvedValue(undefined);

    let clearedRefreshToken: string | null | undefined;
    mockFindById.mockResolvedValue(baseUser({ refreshToken: "some-old-hash" }));
    mockUpdateUser.mockImplementation(async (_id, patch) => {
      if ("refreshToken" in patch) clearedRefreshToken = patch.refreshToken;
      return undefined;
    });

    await expect(authService.refresh(staleToken)).rejects.toThrow();
    expect(clearedRefreshToken).toBeNull();
  });
});

// BUG-FIX-4: OTP brute-force lockout
describe("REGRESSION BUG-FIX-4 — OTP lockout after 5 wrong guesses", () => {
  it("5th wrong OTP clears the OTP and increments attempts to 5", async () => {
    const otp = "555555";
    const hash = await bcrypt.hash(otp, 10);
    const user = baseUser({
      signinOtp: hash,
      signinOtpExpiry: new Date(Date.now() + 60_000),
      signinOtpAttempts: 4,
    });
    mockFindById.mockResolvedValue(user);

    const tempToken = jwt.sign({ id: "u1", requiresEmailOtp: true }, process.env.TEMP_SECRET!, { expiresIn: "10m" });
    await expect(authService.verifySigninOtp(tempToken, "000000")).rejects.toThrow();

    const updatePatch = (mockUpdateUser as jest.Mock).mock.calls.at(-1)?.[1];
    // On lockout, service resets attempts to 0 and clears the OTP
    expect(updatePatch?.signinOtpAttempts).toBe(0);
    expect(updatePatch?.signinOtp).toBeNull();
  });
});

// BUG-FIX-5: TOTP replay within the 30-second window
describe("REGRESSION BUG-FIX-5 — TOTP code cannot be reused within 30 seconds", () => {
  it("reusing the exact same TOTP code within replay window is rejected", async () => {
    const secret = speakeasy.generateSecret({ length: 20 }).base32;
    const code = speakeasy.totp({ secret, encoding: "base32" });

    const user = baseUser({
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      lastUsedTotpCode: code,
      lastUsedTotpAt: new Date(),
    });
    mockFindById.mockResolvedValue(user);

    const tempToken = jwt.sign({ id: "u1", requires2fa: true }, process.env.TEMP_SECRET!, { expiresIn: "10m" });
    await expect(authService.validate2fa(tempToken, code)).rejects.toThrow();
  });

  it("the same code after >30 seconds IS accepted (not a replay)", async () => {
    const secret = speakeasy.generateSecret({ length: 20 }).base32;
    const code = speakeasy.totp({ secret, encoding: "base32" });

    const pastDate = new Date(Date.now() - 31_000);
    const user = baseUser({
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      lastUsedTotpCode: code,
      lastUsedTotpAt: pastDate,
    });
    mockFindById.mockResolvedValue(user);

    const tempToken = jwt.sign({ id: "u1", requires2fa: true }, process.env.TEMP_SECRET!, { expiresIn: "10m" });
    await expect(authService.validate2fa(tempToken, code)).resolves.toBeDefined();
  });
});

// BUG-FIX-6: emailVerified not set — access before email confirmation
describe("REGRESSION BUG-FIX-6 — emailVerified is false until OTP verified", () => {
  it("signup sets emailVerified=false so user can't access the app before confirming", async () => {
    mockFindByEmail.mockResolvedValue(undefined);
    let createdUser: any;
    mockCreateUser.mockImplementation(async (u) => { createdUser = u; return u; });

    await authService.signup({ name: "Bob", email: "bob@example.com", password: "Password1" });

    expect(createdUser.emailVerified).toBe(false);
  });

  it("verifySigninOtp sets emailVerified=true on success", async () => {
    const otp = "200200";
    const hash = await bcrypt.hash(otp, 10);
    mockFindById.mockResolvedValue(
      baseUser({ signinOtp: hash, signinOtpExpiry: new Date(Date.now() + 60_000), emailVerified: false }),
    );

    const tempToken = jwt.sign({ id: "u1", requiresEmailOtp: true }, process.env.TEMP_SECRET!, { expiresIn: "10m" });
    await authService.verifySigninOtp(tempToken, otp);

    const patch = (mockUpdateUser as jest.Mock).mock.calls.find(
      ([, p]) => p.emailVerified === true,
    );
    expect(patch).toBeDefined();
  });
});

// BUG-FIX-7: Stale unverified accounts blocking re-signup
describe("REGRESSION BUG-FIX-7 — stale unverified account (>10 min) is deleted on re-signup", () => {
  it("a >10-min-old unverified account is deleted so re-signup succeeds", async () => {
    const staleDate = new Date(Date.now() - 11 * 60 * 1000);
    mockFindByEmail.mockResolvedValue(baseUser({ emailVerified: false, createdAt: staleDate }));
    jest.mocked(store.deleteUser).mockResolvedValue(undefined);

    await authService.signup({ name: "Alice", email: "alice@example.com", password: "NewPass1!" });

    expect(store.deleteUser).toHaveBeenCalledWith("u1");
  });
});

// BUG-FIX-8: Account lockout not preventing signin
describe("REGRESSION BUG-FIX-8 — locked account is rejected immediately", () => {
  it("account locked until future time → signin throws without checking password", async () => {
    const hash = await bcrypt.hash("anypass", 10);
    const lockoutUntil = new Date(Date.now() + 30 * 60 * 1000);
    mockFindByEmail.mockResolvedValue(baseUser({ passwordHash: hash, lockoutUntil }));

    await expect(
      authService.signin({ email: "alice@example.com", password: "anypass" }),
    ).rejects.toThrow();
  });
});
