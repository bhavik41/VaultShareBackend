import bcrypt from "bcryptjs";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import speakeasy from "speakeasy";
import type { StoredUser } from "../../src/db/inMemoryStore";

jest.mock("../../src/db/inMemoryStore", () => ({
  findUserByEmail: jest.fn(),
  findUserById: jest.fn(),
  findUsersByIds: jest.fn(),
  findUserByRefreshTokenHash: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
  deleteUser: jest.fn(),
}));

jest.mock("../../src/utils/email", () => ({
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
  sendSigninOtpEmail: jest.fn().mockResolvedValue(undefined),
}));

import * as userStore from "../../src/db/inMemoryStore";
import { sendPasswordResetEmail, sendSigninOtpEmail } from "../../src/utils/email";
import * as authService from "../../src/services/auth.service";

// ─── in-memory store simulation ───────────────────────────────────────────────

const users = new Map<string, StoredUser>();
let counter = 0;

const findUserByEmail = jest.mocked(userStore.findUserByEmail);
const findUserById = jest.mocked(userStore.findUserById);
const findUserByRefreshTokenHash = jest.mocked(userStore.findUserByRefreshTokenHash);
const createUser = jest.mocked(userStore.createUser);
const updateUser = jest.mocked(userStore.updateUser);
const deleteUser = jest.mocked(userStore.deleteUser);
const sendResetEmail = jest.mocked(sendPasswordResetEmail);
const sendOtpEmail = jest.mocked(sendSigninOtpEmail);

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function seedUser(overrides: Partial<StoredUser> & { password?: string } = {}): Promise<StoredUser> {
  const n = ++counter;
  const passwordHash =
    overrides.passwordHash ?? (await bcrypt.hash(overrides.password ?? "Password123!", 4));

  const user: StoredUser = {
    id: overrides.id ?? `user-${n}`,
    name: overrides.name ?? "Test User",
    email: overrides.email ?? `user${n}@example.com`,
    passwordHash,
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
    refreshToken: overrides.refreshToken ?? null,
    twoFactorSecret: overrides.twoFactorSecret ?? null,
    twoFactorEnabled: overrides.twoFactorEnabled ?? false,
    lastUsedTotpCode: overrides.lastUsedTotpCode ?? null,
    lastUsedTotpAt: overrides.lastUsedTotpAt ?? null,
    resetOtp: overrides.resetOtp ?? null,
    resetOtpExpiry: overrides.resetOtpExpiry ?? null,
    signinOtp: overrides.signinOtp ?? null,
    signinOtpExpiry: overrides.signinOtpExpiry ?? null,
    signinOtpAttempts: overrides.signinOtpAttempts ?? 0,
    failedLoginAttempts: overrides.failedLoginAttempts ?? 0,
    lockoutUntil: overrides.lockoutUntil ?? null,
    emailVerified: overrides.emailVerified ?? true,
  };

  users.set(user.id, user);
  return user;
}

function savedUser(id: string): StoredUser {
  const u = users.get(id);
  if (!u) throw new Error(`Missing seeded user ${id}`);
  return u;
}

beforeEach(() => {
  users.clear();
  counter = 0;

  findUserByEmail.mockImplementation(async (email) =>
    [...users.values()].find((u) => u.email === email.toLowerCase().trim()),
  );
  findUserById.mockImplementation(async (id) => users.get(id));
  findUserByRefreshTokenHash.mockImplementation(async (hash) =>
    [...users.values()].find((u) => u.refreshToken === hash),
  );
  createUser.mockImplementation(async (user) => {
    users.set(user.id, user);
    return user;
  });
  updateUser.mockImplementation(async (id, updates) => {
    const u = users.get(id);
    if (!u) return undefined;
    const updated = { ...u, ...updates };
    users.set(id, updated);
    return updated;
  });
  deleteUser.mockImplementation(async (id) => {
    users.delete(id);
  });
});

// ─── signup ───────────────────────────────────────────────────────────────────

describe("auth.service signup", () => {
  it("returns requiresOtp + tempToken and sends OTP email", async () => {
    const result = await authService.signup({
      name: " Alice ",
      email: "ALICE@example.com",
      password: "Password123!",
    });

    expect(result).toEqual({ requiresOtp: true, tempToken: expect.any(String) });
    expect(sendOtpEmail).toHaveBeenCalledWith("alice@example.com", expect.any(String));
  });

  it("normalises name/email, stores bcrypt hash, and sets emailVerified=false", async () => {
    await authService.signup({
      name: " Alice ",
      email: "ALICE@example.com",
      password: "Password123!",
    });

    const stored = [...users.values()][0];
    expect(stored.email).toBe("alice@example.com");
    expect(stored.name).toBe("Alice");
    expect(stored.emailVerified).toBe(false);
    await expect(bcrypt.compare("Password123!", stored.passwordHash)).resolves.toBe(true);
  });

  it("rejects a duplicate verified email", async () => {
    await seedUser({ email: "alice@example.com", emailVerified: true });

    await expect(
      authService.signup({ name: "Alice", email: "alice@example.com", password: "Password123!" }),
    ).rejects.toThrow("An account with this email already exists.");
  });

  it("rejects re-signup when existing unverified account is recent (<10 min)", async () => {
    await seedUser({
      email: "alice@example.com",
      emailVerified: false,
      createdAt: new Date(Date.now() - 5 * 60 * 1000),
    });

    await expect(
      authService.signup({ name: "Alice", email: "alice@example.com", password: "Password123!" }),
    ).rejects.toThrow("An account with this email already exists.");
  });

  it("deletes stale unverified account (>10 min) and allows re-signup", async () => {
    const stale = await seedUser({
      email: "alice@example.com",
      emailVerified: false,
      createdAt: new Date(Date.now() - 11 * 60 * 1000),
    });

    await expect(
      authService.signup({ name: "Alice", email: "alice@example.com", password: "Password123!" }),
    ).resolves.toMatchObject({ requiresOtp: true });

    expect(deleteUser).toHaveBeenCalledWith(stale.id);
    expect([...users.values()].find((u) => u.id === stale.id)).toBeUndefined();
  });

  it("rejects invalid email format", async () => {
    await expect(
      authService.signup({ name: "Alice", email: "not-an-email", password: "Password123!" }),
    ).rejects.toThrow("Invalid email address.");
  });

  it("rejects password shorter than 8 characters", async () => {
    await expect(
      authService.signup({ name: "Alice", email: "alice@example.com", password: "short" }),
    ).rejects.toThrow("Password must be at least 8 characters.");
  });
});

// ─── signin ───────────────────────────────────────────────────────────────────

describe("auth.service signin", () => {
  it("sends OTP email and returns requiresOtp tempToken for valid non-2FA credentials", async () => {
    await seedUser({ email: "alice@example.com", password: "Password123!" });

    const result = await authService.signin({ email: "alice@example.com", password: "Password123!" });

    expect(result).toEqual({ requires2fa: false, requiresOtp: true, tempToken: expect.any(String) });
    expect(sendOtpEmail).toHaveBeenCalledWith("alice@example.com", expect.any(String));
  });

  it("resets signinOtpAttempts to 0 when a fresh OTP is issued", async () => {
    const user = await seedUser({
      email: "alice@example.com",
      password: "Password123!",
      signinOtpAttempts: 3,
    });

    await authService.signin({ email: "alice@example.com", password: "Password123!" });

    expect(savedUser(user.id).signinOtpAttempts).toBe(0);
  });

  it("returns a temp token with requires2fa=true for a 2FA-enabled user", async () => {
    const secret = speakeasy.generateSecret().base32;
    await seedUser({
      email: "alice@example.com",
      password: "Password123!",
      twoFactorEnabled: true,
      twoFactorSecret: secret,
    });

    const result = await authService.signin({ email: "alice@example.com", password: "Password123!" });

    expect(result).toEqual({ requires2fa: true, requiresOtp: false, tempToken: expect.any(String) });
    expect(sendOtpEmail).not.toHaveBeenCalled();
  });

  it("resets failedLoginAttempts to 0 on successful signin", async () => {
    const user = await seedUser({
      email: "alice@example.com",
      password: "Password123!",
      failedLoginAttempts: 3,
    });

    await authService.signin({ email: "alice@example.com", password: "Password123!" });

    expect(savedUser(user.id).failedLoginAttempts).toBe(0);
  });

  it("uses the same error for wrong password and unknown email", async () => {
    await seedUser({ email: "alice@example.com", password: "Password123!" });

    await expect(
      authService.signin({ email: "alice@example.com", password: "WrongPassword!" }),
    ).rejects.toThrow("Invalid email or password.");

    await expect(
      authService.signin({ email: "ghost@example.com", password: "Password123!" }),
    ).rejects.toThrow("Invalid email or password.");
  });

  it("increments failedLoginAttempts on each wrong password", async () => {
    const user = await seedUser({ email: "alice@example.com", password: "Password123!" });

    await authService.signin({ email: "alice@example.com", password: "Wrong!" }).catch(() => {});
    expect(savedUser(user.id).failedLoginAttempts).toBe(1);

    await authService.signin({ email: "alice@example.com", password: "Wrong!" }).catch(() => {});
    expect(savedUser(user.id).failedLoginAttempts).toBe(2);
  });

  it("locks the account after 5 consecutive failed attempts", async () => {
    const user = await seedUser({ email: "alice@example.com", password: "Password123!" });

    for (let i = 0; i < 5; i++) {
      await authService.signin({ email: "alice@example.com", password: "Wrong!" }).catch(() => {});
    }

    const stored = savedUser(user.id);
    expect(stored.lockoutUntil).not.toBeNull();
    expect(stored.lockoutUntil!.getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects signin immediately when account is locked", async () => {
    await seedUser({
      email: "alice@example.com",
      password: "Password123!",
      lockoutUntil: new Date(Date.now() + 15 * 60 * 1000),
    });

    await expect(
      authService.signin({ email: "alice@example.com", password: "Password123!" }),
    ).rejects.toThrow(/Account locked/);
  });
});

// ─── verifySigninOtp ──────────────────────────────────────────────────────────

describe("auth.service verifySigninOtp", () => {
  async function setupOtpFlow(otpOverrides: Partial<StoredUser> = {}) {
    const otp = "123456";
    const otpHash = await bcrypt.hash(otp, 4);
    const user = await seedUser({
      email: "alice@example.com",
      emailVerified: false,
      signinOtp: otpHash,
      signinOtpExpiry: new Date(Date.now() + 10 * 60 * 1000),
      signinOtpAttempts: 0,
      ...otpOverrides,
    });
    const tempToken = authService.issueTempToken({ id: user.id, requiresEmailOtp: true });
    return { user, tempToken, otp };
  }

  it("issues access + refresh tokens for a correct OTP", async () => {
    const { tempToken, otp } = await setupOtpFlow();

    const result = await authService.verifySigninOtp(tempToken, otp);

    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.user.email).toBe("alice@example.com");
  });

  it("stores the hashed refresh token, not the plaintext JWT", async () => {
    const { user, tempToken, otp } = await setupOtpFlow();

    const result = await authService.verifySigninOtp(tempToken, otp);

    const storedToken = savedUser(user.id).refreshToken;
    expect(storedToken).toBe(hashToken(result.refreshToken));
    expect(storedToken).not.toBe(result.refreshToken);
  });

  it("sets emailVerified=true on successful OTP", async () => {
    const { user, tempToken, otp } = await setupOtpFlow();

    await authService.verifySigninOtp(tempToken, otp);

    expect(savedUser(user.id).emailVerified).toBe(true);
  });

  it("clears OTP fields and resets attempt counter on success", async () => {
    const { user, tempToken, otp } = await setupOtpFlow({ signinOtpAttempts: 2 });

    await authService.verifySigninOtp(tempToken, otp);

    const stored = savedUser(user.id);
    expect(stored.signinOtp).toBeNull();
    expect(stored.signinOtpExpiry).toBeNull();
    expect(stored.signinOtpAttempts).toBe(0);
  });

  it("rejects an expired OTP", async () => {
    const { tempToken, otp } = await setupOtpFlow({
      signinOtpExpiry: new Date(Date.now() - 1000),
    });

    await expect(authService.verifySigninOtp(tempToken, otp)).rejects.toThrow(
      "Verification code has expired",
    );
  });

  it("rejects a wrong OTP and increments the attempt counter", async () => {
    const { user, tempToken } = await setupOtpFlow();

    await expect(authService.verifySigninOtp(tempToken, "000000")).rejects.toThrow(
      "Incorrect verification code.",
    );
    expect(savedUser(user.id).signinOtpAttempts).toBe(1);
  });

  it("clears OTP and locks out after 5 wrong attempts", async () => {
    const { user, tempToken } = await setupOtpFlow({ signinOtpAttempts: 4 });

    await expect(authService.verifySigninOtp(tempToken, "000000")).rejects.toThrow(
      "Too many incorrect attempts",
    );

    const stored = savedUser(user.id);
    expect(stored.signinOtp).toBeNull();
    expect(stored.signinOtpExpiry).toBeNull();
    expect(stored.signinOtpAttempts).toBe(0);
  });

  it("rejects an invalid or tampered temp token", async () => {
    const badToken = jwt.sign({ id: "x", requiresEmailOtp: true }, "wrong-secret");

    await expect(authService.verifySigninOtp(badToken, "123456")).rejects.toThrow(
      "Verification code expired",
    );
  });
});

// ─── refresh token lifecycle ──────────────────────────────────────────────────

describe("auth.service refresh token lifecycle", () => {
  it("issues new tokens and stores the hash of the new refresh token", async () => {
    const user = await seedUser({ email: "alice@example.com" });
    const refreshToken = authService.issueRefreshToken({
      id: user.id, email: user.email, name: user.name, twoFactorEnabled: false,
    });
    users.set(user.id, { ...user, refreshToken: hashToken(refreshToken) });

    const result = await authService.refresh(refreshToken);

    expect(result.newAccessToken).toEqual(expect.any(String));
    expect(result.newRefreshToken).not.toBe(refreshToken);
    expect(savedUser(user.id).refreshToken).toBe(hashToken(result.newRefreshToken));
  });

  it("detects token reuse: valid JWT but hash absent from DB → revokes all sessions", async () => {
    const user = await seedUser({ email: "alice@example.com", refreshToken: null });
    const refreshToken = authService.issueRefreshToken({
      id: user.id, email: user.email, name: user.name, twoFactorEnabled: false,
    });
    // Hash intentionally NOT stored — simulates an already-rotated token

    await expect(authService.refresh(refreshToken)).rejects.toThrow("Refresh token already used");
    expect(savedUser(user.id).refreshToken).toBeNull();
  });

  it("rejects a tampered (invalid signature) refresh token", async () => {
    const user = await seedUser({ email: "alice@example.com" });
    const refreshToken = authService.issueRefreshToken({
      id: user.id, email: user.email, name: user.name, twoFactorEnabled: false,
    });

    await expect(authService.refresh(`${refreshToken}tampered`)).rejects.toThrow(
      "Invalid or expired refresh token.",
    );
  });

  it("clears the stored refresh token on logout", async () => {
    const user = await seedUser({ refreshToken: hashToken("some-active-token") });

    await authService.logout(user.id);

    expect(savedUser(user.id).refreshToken).toBeNull();
  });
});

// ─── password reset ───────────────────────────────────────────────────────────

describe("auth.service password reset", () => {
  it("stores a hashed OTP and emails the plaintext OTP", async () => {
    const user = await seedUser({ email: "alice@example.com" });

    await authService.forgotPassword("alice@example.com");

    expect(sendResetEmail).toHaveBeenCalledWith("alice@example.com", expect.any(String));
    const sentOtp = sendResetEmail.mock.calls[0][1];
    const stored = savedUser(user.id);
    expect(stored.resetOtp).not.toBe(sentOtp);
    await expect(bcrypt.compare(sentOtp, stored.resetOtp!)).resolves.toBe(true);
    expect(stored.resetOtpExpiry!.getTime()).toBeGreaterThan(Date.now());
  });

  it("returns silently for an unknown email (no enumeration)", async () => {
    await expect(authService.forgotPassword("ghost@example.com")).resolves.toBeUndefined();
    expect(sendResetEmail).not.toHaveBeenCalled();
  });

  it("resets password, clears OTP fields, and revokes the refresh token", async () => {
    const user = await seedUser({
      email: "alice@example.com",
      refreshToken: hashToken("active-session"),
      resetOtp: await bcrypt.hash("123456", 4),
      resetOtpExpiry: new Date(Date.now() + 60_000),
    });

    await authService.resetPassword({
      email: "alice@example.com",
      otp: "123456",
      newPassword: "NewPassword123!",
    });

    const updated = savedUser(user.id);
    await expect(bcrypt.compare("NewPassword123!", updated.passwordHash)).resolves.toBe(true);
    expect(updated.resetOtp).toBeNull();
    expect(updated.resetOtpExpiry).toBeNull();
    expect(updated.refreshToken).toBeNull();
  });

  it("rejects an expired reset OTP", async () => {
    await seedUser({
      email: "alice@example.com",
      resetOtp: await bcrypt.hash("123456", 4),
      resetOtpExpiry: new Date(Date.now() - 1000),
    });

    await expect(
      authService.resetPassword({ email: "alice@example.com", otp: "123456", newPassword: "NewPassword123!" }),
    ).rejects.toThrow("Invalid or expired OTP.");
  });

  it("rejects a wrong reset OTP", async () => {
    await seedUser({
      email: "alice@example.com",
      resetOtp: await bcrypt.hash("123456", 4),
      resetOtpExpiry: new Date(Date.now() + 60_000),
    });

    await expect(
      authService.resetPassword({ email: "alice@example.com", otp: "000000", newPassword: "NewPassword123!" }),
    ).rejects.toThrow("Invalid or expired OTP.");
  });

  it("rejects a new password shorter than 8 characters", async () => {
    await seedUser({
      email: "alice@example.com",
      resetOtp: await bcrypt.hash("123456", 4),
      resetOtpExpiry: new Date(Date.now() + 60_000),
    });

    await expect(
      authService.resetPassword({ email: "alice@example.com", otp: "123456", newPassword: "short" }),
    ).rejects.toThrow("Password must be at least 8 characters.");
  });
});

// ─── 2FA ──────────────────────────────────────────────────────────────────────

describe("auth.service 2FA setup and verify", () => {
  it("setup2fa: returns QR code + secret and stores the secret", async () => {
    const user = await seedUser();

    const result = await authService.setup2fa(user.id);

    expect(result.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(result.secret).toEqual(expect.any(String));
    expect(savedUser(user.id).twoFactorSecret).toBe(result.secret);
  });

  it("setup2fa: rejects when 2FA is already enabled", async () => {
    const user = await seedUser({
      twoFactorEnabled: true,
      twoFactorSecret: speakeasy.generateSecret().base32,
    });

    await expect(authService.setup2fa(user.id)).rejects.toThrow("2FA is already enabled.");
  });

  it("verify2fa: enables 2FA for a valid TOTP code", async () => {
    const secret = speakeasy.generateSecret().base32;
    const user = await seedUser({ twoFactorSecret: secret, twoFactorEnabled: false });
    const token = speakeasy.totp({ secret, encoding: "base32" });

    await authService.verify2fa(user.id, token);

    expect(savedUser(user.id).twoFactorEnabled).toBe(true);
  });

  it("verify2fa: rejects an invalid TOTP code", async () => {
    const user = await seedUser({ twoFactorSecret: speakeasy.generateSecret().base32 });

    await expect(authService.verify2fa(user.id, "000000")).rejects.toThrow("Invalid TOTP code.");
  });
});

describe("auth.service validate2fa", () => {
  it("issues full tokens for a valid TOTP and stores the hashed refresh token", async () => {
    const secret = speakeasy.generateSecret().base32;
    const user = await seedUser({ twoFactorEnabled: true, twoFactorSecret: secret });
    const tempToken = authService.issueTempToken({ id: user.id, requires2fa: true });
    const token = speakeasy.totp({ secret, encoding: "base32" });

    const result = await authService.validate2fa(tempToken, token);

    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(savedUser(user.id).refreshToken).toBe(hashToken(result.refreshToken));
  });

  it("stores lastUsedTotpCode and lastUsedTotpAt after a successful validate", async () => {
    const secret = speakeasy.generateSecret().base32;
    const user = await seedUser({ twoFactorEnabled: true, twoFactorSecret: secret });
    const tempToken = authService.issueTempToken({ id: user.id, requires2fa: true });
    const token = speakeasy.totp({ secret, encoding: "base32" });

    await authService.validate2fa(tempToken, token);

    const stored = savedUser(user.id);
    expect(stored.lastUsedTotpCode).toBe(token);
    expect(stored.lastUsedTotpAt).toBeInstanceOf(Date);
  });

  it("rejects TOTP replay within the 30-second window", async () => {
    const secret = speakeasy.generateSecret().base32;
    const token = speakeasy.totp({ secret, encoding: "base32" });
    const user = await seedUser({
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      lastUsedTotpCode: token,
      lastUsedTotpAt: new Date(Date.now() - 10_000), // used 10s ago — within 30s
    });
    const tempToken = authService.issueTempToken({ id: user.id, requires2fa: true });

    await expect(authService.validate2fa(tempToken, token)).rejects.toThrow(
      "This code has already been used",
    );
  });

  it("rejects an invalid (tampered) temp token", async () => {
    const secret = speakeasy.generateSecret().base32;
    await seedUser({ id: "target", twoFactorEnabled: true, twoFactorSecret: secret });
    const badToken = jwt.sign({ id: "target", requires2fa: true }, "wrong-secret");
    const code = speakeasy.totp({ secret, encoding: "base32" });

    await expect(authService.validate2fa(badToken, code)).rejects.toThrow(
      "Temp token invalid or expired.",
    );
  });

  it("rejects an incorrect TOTP code", async () => {
    const secret = speakeasy.generateSecret().base32;
    const user = await seedUser({ twoFactorEnabled: true, twoFactorSecret: secret });
    const tempToken = authService.issueTempToken({ id: user.id, requires2fa: true });

    await expect(authService.validate2fa(tempToken, "000000")).rejects.toThrow("Invalid TOTP code.");
  });
});

describe("auth.service disable2fa", () => {
  it("disables 2FA, clears the secret, revokes the refresh token, and clears TOTP replay fields", async () => {
    const secret = speakeasy.generateSecret().base32;
    const user = await seedUser({
      twoFactorEnabled: true,
      twoFactorSecret: secret,
      refreshToken: hashToken("active-session"),
      lastUsedTotpCode: "111111",
      lastUsedTotpAt: new Date(),
    });
    const token = speakeasy.totp({ secret, encoding: "base32" });

    await authService.disable2fa(user.id, token);

    const stored = savedUser(user.id);
    expect(stored.twoFactorEnabled).toBe(false);
    expect(stored.twoFactorSecret).toBeNull();
    expect(stored.refreshToken).toBeNull();
    expect(stored.lastUsedTotpCode).toBeNull();
    expect(stored.lastUsedTotpAt).toBeNull();
  });

  it("rejects an invalid TOTP and leaves 2FA enabled", async () => {
    const user = await seedUser({
      twoFactorEnabled: true,
      twoFactorSecret: speakeasy.generateSecret().base32,
    });

    await expect(authService.disable2fa(user.id, "000000")).rejects.toThrow(
      "Invalid TOTP code. Cannot disable 2FA.",
    );
    expect(savedUser(user.id).twoFactorEnabled).toBe(true);
  });

  it("rejects when 2FA is not enabled", async () => {
    const user = await seedUser({ twoFactorEnabled: false });

    await expect(authService.disable2fa(user.id, "123456")).rejects.toThrow("2FA is not enabled.");
  });
});
