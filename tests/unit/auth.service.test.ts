import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import speakeasy from "speakeasy";
import type { StoredUser } from "../../src/db/inMemoryStore";

jest.mock("../../src/db/inMemoryStore", () => ({
  findUserByEmail: jest.fn(),
  findUserById: jest.fn(),
  findUsersByIds: jest.fn(),
  findUserByRefreshToken: jest.fn(),
  createUser: jest.fn(),
  updateUser: jest.fn(),
}));

jest.mock("../../src/utils/email", () => ({
  sendPasswordResetEmail: jest.fn(),
}));

import * as userStore from "../../src/db/inMemoryStore";
import { sendPasswordResetEmail } from "../../src/utils/email";
import * as authService from "../../src/services/auth.service";

const users = new Map<string, StoredUser>();

const findUserByEmail = jest.mocked(userStore.findUserByEmail);
const findUserById = jest.mocked(userStore.findUserById);
const findUserByRefreshToken = jest.mocked(userStore.findUserByRefreshToken);
const createUser = jest.mocked(userStore.createUser);
const updateUser = jest.mocked(userStore.updateUser);
const sendResetEmail = jest.mocked(sendPasswordResetEmail);

async function seedUser(
  overrides: Partial<StoredUser> & { password?: string } = {},
): Promise<StoredUser> {
  const passwordHash =
    overrides.passwordHash ?? (await bcrypt.hash(overrides.password ?? "Password123", 4));

  const user: StoredUser = {
    id: overrides.id ?? `user-${users.size + 1}`,
    name: overrides.name ?? "Test User",
    email: overrides.email ?? `user${users.size + 1}@example.com`,
    passwordHash,
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
    refreshToken: overrides.refreshToken ?? null,
    twoFactorSecret: overrides.twoFactorSecret ?? null,
    twoFactorEnabled: overrides.twoFactorEnabled ?? false,
    resetOtp: overrides.resetOtp ?? null,
    resetOtpExpiry: overrides.resetOtpExpiry ?? null,
    failedLoginAttempts: overrides.failedLoginAttempts ?? 0,
    lockoutUntil: overrides.lockoutUntil ?? null,
  };

  users.set(user.id, user);
  return user;
}

function savedUser(id: string): StoredUser {
  const user = users.get(id);
  if (!user) throw new Error(`Missing seeded user ${id}`);
  return user;
}

beforeEach(() => {
  users.clear();

  findUserByEmail.mockImplementation(async (email: string) =>
    [...users.values()].find((user) => user.email === email.toLowerCase().trim()),
  );
  findUserById.mockImplementation(async (id: string) => users.get(id));
  findUserByRefreshToken.mockImplementation(async (refreshToken: string) =>
    [...users.values()].find((user) => user.refreshToken === refreshToken),
  );
  createUser.mockImplementation(async (user: StoredUser) => {
    users.set(user.id, user);
    return user;
  });
  updateUser.mockImplementation(async (id: string, updates: Partial<StoredUser>) => {
    const user = users.get(id);
    if (!user) return undefined;

    const updated = { ...user, ...updates };
    users.set(id, updated);
    return updated;
  });
  sendResetEmail.mockResolvedValue(undefined);
});

describe("auth.service signup", () => {
  it("returns tokens and stores a bcrypt hash instead of plaintext", async () => {
    const result = await authService.signup({
      name: " Alice ",
      email: "ALICE@example.com",
      password: "Password123",
    });

    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.user.email).toBe("alice@example.com");
    expect(result.user.name).toBe("Alice");

    const stored = savedUser(result.user.id);
    expect(stored.passwordHash).not.toBe("Password123");
    await expect(bcrypt.compare("Password123", stored.passwordHash)).resolves.toBe(true);
    expect(stored.refreshToken).toBe(result.refreshToken);
  });

  it("rejects duplicate emails", async () => {
    await seedUser({ email: "alice@example.com" });

    await expect(
      authService.signup({
        name: "Alice",
        email: "alice@example.com",
        password: "Password123",
      }),
    ).rejects.toThrow("An account with this email already exists.");
  });

  it("rejects invalid email formats", async () => {
    await expect(
      authService.signup({
        name: "Alice",
        email: "not-an-email",
        password: "Password123",
      }),
    ).rejects.toThrow("Invalid email address.");
  });

  it("rejects passwords shorter than 8 characters", async () => {
    await expect(
      authService.signup({
        name: "Alice",
        email: "alice@example.com",
        password: "short",
      }),
    ).rejects.toThrow("Password must be at least 8 characters.");
  });
});

describe("auth.service signin", () => {
  it("returns tokens and user data for valid credentials", async () => {
    const user = await seedUser({ email: "alice@example.com", password: "Password123" });

    const result = await authService.signin({
      email: "alice@example.com",
      password: "Password123",
    });

    expect(result).toMatchObject({
      requires2fa: false,
      user: expect.objectContaining({ id: user.id, email: user.email }),
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
    expect(savedUser(user.id).refreshToken).toBe(result.refreshToken);
    expect(savedUser(user.id).failedLoginAttempts).toBe(0);
  });

  it("uses the same error for wrong password and unknown email", async () => {
    await seedUser({ email: "alice@example.com", password: "Password123" });

    await expect(
      authService.signin({ email: "alice@example.com", password: "WrongPassword123" }),
    ).rejects.toThrow("Invalid email or password.");

    await expect(
      authService.signin({ email: "missing@example.com", password: "WrongPassword123" }),
    ).rejects.toThrow("Invalid email or password.");
  });

  it("returns a temp token instead of full tokens when 2FA is enabled", async () => {
    await seedUser({
      email: "alice@example.com",
      password: "Password123",
      twoFactorEnabled: true,
      twoFactorSecret: speakeasy.generateSecret().base32,
    });

    const result = await authService.signin({
      email: "alice@example.com",
      password: "Password123",
    });

    expect(result).toEqual({
      requires2fa: true,
      tempToken: expect.any(String),
    });
    expect("accessToken" in result).toBe(false);
    expect("refreshToken" in result).toBe(false);
  });
});

describe("auth.service token lifecycle", () => {
  it("refreshes a valid refresh token and rotates the stored token", async () => {
    const user = await seedUser({ email: "alice@example.com" });
    const refreshToken = authService.issueRefreshToken({
      id: user.id,
      email: user.email,
      name: user.name,
      twoFactorEnabled: false,
    });
    users.set(user.id, { ...user, refreshToken });

    const result = await authService.refresh(refreshToken);

    expect(result.newAccessToken).toEqual(expect.any(String));
    expect(result.newRefreshToken).toEqual(expect.any(String));
    expect(result.newRefreshToken).not.toBe(refreshToken);
    expect(savedUser(user.id).refreshToken).toBe(result.newRefreshToken);
  });

  it("rejects a valid JWT refresh token that is not stored", async () => {
    const user = await seedUser({ email: "alice@example.com" });
    const refreshToken = authService.issueRefreshToken({
      id: user.id,
      email: user.email,
      name: user.name,
      twoFactorEnabled: false,
    });

    await expect(authService.refresh(refreshToken)).rejects.toThrow(
      "Refresh token revoked or not found.",
    );
  });

  it("rejects tampered refresh tokens", async () => {
    const user = await seedUser({ email: "alice@example.com" });
    const refreshToken = authService.issueRefreshToken({
      id: user.id,
      email: user.email,
      name: user.name,
      twoFactorEnabled: false,
    });

    await expect(authService.refresh(`${refreshToken}x`)).rejects.toThrow(
      "Invalid or expired refresh token.",
    );
  });

  it("clears the stored refresh token on logout", async () => {
    const user = await seedUser({ refreshToken: "stored-refresh-token" });

    await authService.logout(user.id);

    expect(savedUser(user.id).refreshToken).toBeNull();
  });
});

describe("auth.service password reset", () => {
  it("stores a hashed OTP and sends the plaintext OTP for known emails", async () => {
    const user = await seedUser({ email: "alice@example.com" });

    await authService.forgotPassword("alice@example.com");

    expect(sendResetEmail).toHaveBeenCalledWith("alice@example.com", expect.any(String));
    const sentOtp = sendResetEmail.mock.calls[0][1];
    const stored = savedUser(user.id);
    expect(stored.resetOtp).not.toBe(sentOtp);
    expect(stored.resetOtpExpiry?.getTime()).toBeGreaterThan(Date.now());
    await expect(bcrypt.compare(sentOtp, stored.resetOtp!)).resolves.toBe(true);
  });

  it("does not throw or send email for unknown emails", async () => {
    await expect(authService.forgotPassword("missing@example.com")).resolves.toBeUndefined();
    expect(sendResetEmail).not.toHaveBeenCalled();
  });

  it("updates password, clears OTP fields, and clears refresh token for a correct OTP", async () => {
    const user = await seedUser({
      email: "alice@example.com",
      password: "OldPassword123",
      refreshToken: "existing-refresh-token",
      resetOtp: await bcrypt.hash("123456", 4),
      resetOtpExpiry: new Date(Date.now() + 60_000),
    });

    await authService.resetPassword({
      email: "alice@example.com",
      otp: "123456",
      newPassword: "NewPassword123",
    });

    const updated = savedUser(user.id);
    await expect(bcrypt.compare("NewPassword123", updated.passwordHash)).resolves.toBe(true);
    expect(updated.resetOtp).toBeNull();
    expect(updated.resetOtpExpiry).toBeNull();
    expect(updated.refreshToken).toBeNull();
  });

  it("rejects expired OTPs", async () => {
    await seedUser({
      email: "alice@example.com",
      resetOtp: await bcrypt.hash("123456", 4),
      resetOtpExpiry: new Date(Date.now() - 1_000),
    });

    await expect(
      authService.resetPassword({
        email: "alice@example.com",
        otp: "123456",
        newPassword: "NewPassword123",
      }),
    ).rejects.toThrow("Invalid or expired OTP.");
  });

  it("rejects wrong OTPs", async () => {
    await seedUser({
      email: "alice@example.com",
      resetOtp: await bcrypt.hash("123456", 4),
      resetOtpExpiry: new Date(Date.now() + 60_000),
    });

    await expect(
      authService.resetPassword({
        email: "alice@example.com",
        otp: "000000",
        newPassword: "NewPassword123",
      }),
    ).rejects.toThrow("Invalid or expired OTP.");
  });
});

describe("auth.service 2FA", () => {
  it("sets up 2FA and stores the generated secret", async () => {
    const user = await seedUser({ email: "alice@example.com" });

    const result = await authService.setup2fa(user.id);

    expect(result.qrCode).toMatch(/^data:image\/png;base64,/);
    expect(result.secret).toEqual(expect.any(String));
    expect(savedUser(user.id).twoFactorSecret).toBe(result.secret);
  });

  it("rejects setup when 2FA is already enabled", async () => {
    const user = await seedUser({
      twoFactorEnabled: true,
      twoFactorSecret: speakeasy.generateSecret().base32,
    });

    await expect(authService.setup2fa(user.id)).rejects.toThrow("2FA is already enabled.");
  });

  it("enables 2FA for a valid TOTP", async () => {
    const secret = speakeasy.generateSecret().base32;
    const user = await seedUser({ twoFactorSecret: secret, twoFactorEnabled: false });
    const token = speakeasy.totp({ secret, encoding: "base32" });

    await authService.verify2fa(user.id, token);

    expect(savedUser(user.id).twoFactorEnabled).toBe(true);
  });

  it("rejects invalid TOTP during verification", async () => {
    const user = await seedUser({
      twoFactorSecret: speakeasy.generateSecret().base32,
      twoFactorEnabled: false,
    });

    await expect(authService.verify2fa(user.id, "000000")).rejects.toThrow(
      "Invalid TOTP code. Try again.",
    );
  });

  it("validates a temp token and TOTP to issue full tokens", async () => {
    const secret = speakeasy.generateSecret().base32;
    const user = await seedUser({
      email: "alice@example.com",
      twoFactorEnabled: true,
      twoFactorSecret: secret,
    });
    const tempToken = authService.issueTempToken({ id: user.id, requires2fa: true });
    const token = speakeasy.totp({ secret, encoding: "base32" });

    const result = await authService.validate2fa(tempToken, token);

    expect(result.accessToken).toEqual(expect.any(String));
    expect(result.refreshToken).toEqual(expect.any(String));
    expect(result.user.id).toBe(user.id);
    expect(savedUser(user.id).refreshToken).toBe(result.refreshToken);
  });

  it("rejects invalid or expired temp tokens", async () => {
    const secret = speakeasy.generateSecret().base32;
    await seedUser({
      id: "user-2fa",
      twoFactorEnabled: true,
      twoFactorSecret: secret,
    });
    const invalidTempToken = jwt.sign(
      { id: "user-2fa", requires2fa: true },
      "wrong-temp-secret",
    );
    const token = speakeasy.totp({ secret, encoding: "base32" });

    await expect(authService.validate2fa(invalidTempToken, token)).rejects.toThrow(
      "Temp token invalid or expired.",
    );
  });

  it("disables 2FA with a valid TOTP and clears the secret", async () => {
    const secret = speakeasy.generateSecret().base32;
    const user = await seedUser({
      twoFactorEnabled: true,
      twoFactorSecret: secret,
    });
    const token = speakeasy.totp({ secret, encoding: "base32" });

    await authService.disable2fa(user.id, token);

    expect(savedUser(user.id).twoFactorEnabled).toBe(false);
    expect(savedUser(user.id).twoFactorSecret).toBeNull();
  });
});
