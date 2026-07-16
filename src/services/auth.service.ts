import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import speakeasy from "speakeasy";
import QRCode from "qrcode";
import crypto from "crypto";
import { v4 as uuidv4 } from "../utils/uuid";
import {
  findUserByEmail,
  findUserById,
  findUserByRefreshTokenHash,
  createUser,
  updateUser,
  deleteUser,
} from "../db/inMemoryStore";

// Account lockout constants (#5)
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
import type {
  SignupBody,
  SigninBody,
  ResetPasswordBody,
  UserPayload,
  TempTokenPayload,
} from "../types/index";
import { sendPasswordResetEmail, sendSigninOtpEmail, sendReauthOtpEmail } from "../utils/email";

// #82, #83 — Fail fast at startup if required secrets are missing, no fallback chaining
export const JWT_SECRET = process.env.JWT_SECRET as string;
if (!JWT_SECRET) throw new Error("JWT_SECRET is not set in environment.");

export const REFRESH_SECRET = process.env.REFRESH_SECRET as string;
if (!REFRESH_SECRET) throw new Error("REFRESH_SECRET is not set in environment.");

export const TEMP_SECRET = process.env.TEMP_SECRET as string;
if (!TEMP_SECRET) throw new Error("TEMP_SECRET is not set in environment.");

export function issueAccessToken(payload: UserPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "15m" });
}

export function issueRefreshToken(payload: UserPayload): string {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: "7d", jwtid: uuidv4() });
}

export function issueTempToken(payload: TempTokenPayload): string {
  return jwt.sign(payload, TEMP_SECRET, { expiresIn: "5m" });
}

function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString();
}

function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function getMe(userId: string) {
  const user = await findUserById(userId);
  if (!user) throw new Error("User not found.");
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    twoFactorEnabled: user.twoFactorEnabled,
  };
}

export async function signup(data: SignupBody) {
  const { name, email, password } = data;
  // #14 — minimum password length raised to 8
  if (password.length < 8)
    throw new Error("Password must be at least 8 characters.");

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) throw new Error("Invalid email address.");

  // Fix #6 — stale unverified accounts block legitimate registration.
  // If an unverified record older than 10 min exists for this email, delete it
  // and allow the real owner to sign up. Otherwise surface the normal conflict.
  const existing = await findUserByEmail(email);
  if (existing) {
    const stale = !existing.emailVerified &&
      existing.createdAt < new Date(Date.now() - 10 * 60 * 1000);
    if (stale) {
      await deleteUser(existing.id);
    } else {
      throw new Error("An account with this email already exists.");
    }
  }

  // #13 — bcrypt cost raised to 12
  const passwordHash = await bcrypt.hash(password, 12);
  const newUser = await createUser({
    id: uuidv4(),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash,
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
    emailVerified: false,
  });

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiry = new Date(Date.now() + 10 * 60 * 1000);
  await updateUser(newUser.id, { signinOtp: otpHash, signinOtpExpiry: expiry });
  sendSigninOtpEmail(newUser.email, otp).catch((err) =>
    console.error("[signup] failed to send OTP email:", err.message),
  );

  const tempToken = issueTempToken({ id: newUser.id, requiresEmailOtp: true });
  return { requiresOtp: true, tempToken };
}

export async function signin(data: SigninBody) {
  const { email, password } = data;
  const user = await findUserByEmail(email);

  // #5 — Account lockout: check lockout before verifying password
  if (user) {
    const now = new Date();
    if (
      user.lockoutUntil &&
      user.lockoutUntil > now
    ) {
      const remaining = Math.ceil((user.lockoutUntil.getTime() - now.getTime()) / 60000);
      throw new Error(`Account locked. Try again in ${remaining} minute(s).`);
    }
  }

  const passwordMatch = user ? await bcrypt.compare(password, user.passwordHash) : false;

  if (!user || !passwordMatch) {
    // Increment failed attempt counter
    if (user) {
      const attempts = (user.failedLoginAttempts ?? 0) + 1;
      if (attempts >= MAX_FAILED_ATTEMPTS) {
        await updateUser(user.id, {
          failedLoginAttempts: 0,
          lockoutUntil: new Date(Date.now() + LOCKOUT_DURATION_MS),
        });
        throw new Error(`Account locked after too many failed attempts. Try again in 15 minutes.`);
      }
      await updateUser(user.id, { failedLoginAttempts: attempts });
    }
    throw new Error("Invalid email or password.");
  }

  // Reset failed counter on successful password match
  await updateUser(user.id, { failedLoginAttempts: 0, lockoutUntil: null });

  if (user.twoFactorEnabled) {
    const tempToken = issueTempToken({ id: user.id, requires2fa: true });
    return { requires2fa: true, requiresOtp: false, tempToken };
  }

  // Send email OTP for all users without TOTP 2FA
  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  // Reset attempt counter whenever a fresh OTP is issued
  await updateUser(user.id, { signinOtp: otpHash, signinOtpExpiry: expiry, signinOtpAttempts: 0 });
  sendSigninOtpEmail(user.email, otp).catch((err) =>
    console.error("[signin] failed to send OTP email:", err.message),
  );

  const tempToken = issueTempToken({ id: user.id, requiresEmailOtp: true });
  return { requires2fa: false, requiresOtp: true, tempToken };
}

export async function verifySigninOtp(tempToken: string, otp: string) {
  let decoded: TempTokenPayload;
  try {
    decoded = jwt.verify(tempToken, TEMP_SECRET) as TempTokenPayload;
  } catch {
    throw new Error("Verification code expired. Please sign in again.");
  }

  if (!decoded.requiresEmailOtp) throw new Error("Invalid token.");

  const user = await findUserById(decoded.id);
  if (!user || !user.signinOtp || !user.signinOtpExpiry)
    throw new Error("Invalid or expired verification code.");

  if (user.signinOtpExpiry < new Date())
    throw new Error("Verification code has expired. Please sign in again.");

  const otpValid = await bcrypt.compare(otp, user.signinOtp);
  if (!otpValid) {
    // Fix #4 — per-user OTP brute-force protection
    const attempts = (user.signinOtpAttempts ?? 0) + 1;
    if (attempts >= 5) {
      await updateUser(user.id, { signinOtp: null, signinOtpExpiry: null, signinOtpAttempts: 0 });
      throw new Error("Too many incorrect attempts. Please sign in again to receive a new code.");
    }
    await updateUser(user.id, { signinOtpAttempts: attempts });
    throw new Error("Incorrect verification code.");
  }

  // Fix #6 — mark email as verified on first successful OTP
  await updateUser(user.id, {
    signinOtp: null,
    signinOtpExpiry: null,
    signinOtpAttempts: 0,
    emailVerified: true,
  });

  const userPayload: UserPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    twoFactorEnabled: user.twoFactorEnabled,
  };
  const accessToken = issueAccessToken(userPayload);
  const refreshToken = issueRefreshToken(userPayload);
  await updateUser(user.id, { refreshToken: hashRefreshToken(refreshToken) });

  return { user, accessToken, refreshToken };
}

export async function refresh(refreshToken: string) {
  let decoded: UserPayload;
  try {
    decoded = jwt.verify(refreshToken, REFRESH_SECRET) as UserPayload;
  } catch {
    throw new Error("Invalid or expired refresh token.");
  }

  const hash = hashRefreshToken(refreshToken);
  const user = await findUserByRefreshTokenHash(hash);

  if (!user) {
    // JWT signature is valid but hash not in DB — token was already rotated.
    // This is a sign of replay/theft; revoke all sessions for that user.
    const target = await findUserById(decoded.id);
    if (target) await updateUser(target.id, { refreshToken: null });
    throw new Error("Refresh token already used. All sessions have been revoked for security.");
  }

  if (user.id !== decoded.id) {
    throw new Error("Refresh token revoked or not found.");
  }

  const userPayload: UserPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    twoFactorEnabled: user.twoFactorEnabled,
  };
  const newAccessToken = issueAccessToken(userPayload);
  const newRefreshToken = issueRefreshToken(userPayload);
  await updateUser(user.id, { refreshToken: hashRefreshToken(newRefreshToken) });

  return { newAccessToken, newRefreshToken };
}

export async function logout(userId: string) {
  await updateUser(userId, { refreshToken: null });
}

// Idle-timeout re-authentication — session/token stay valid, the UI is just
// gated client-side until a fresh OTP is entered. Reuses the signinOtp fields
// since a user can't be mid-signin and mid-reauth-lock at the same time.
export async function requestReauthOtp(userId: string) {
  const user = await findUserById(userId);
  if (!user) throw new Error("User not found.");

  const otp = generateOtp();
  const otpHash = await bcrypt.hash(otp, 10);
  const expiry = new Date(Date.now() + 5 * 60 * 1000); // 5 min
  await updateUser(user.id, { signinOtp: otpHash, signinOtpExpiry: expiry, signinOtpAttempts: 0 });
  sendReauthOtpEmail(user.email, otp).catch((err) =>
    console.error("[reauth] failed to send OTP email:", err.message),
  );
}

export async function verifyReauthOtp(userId: string, otp: string) {
  const user = await findUserById(userId);
  if (!user || !user.signinOtp || !user.signinOtpExpiry)
    throw new Error("Invalid or expired code. Request a new one.");

  if (user.signinOtpExpiry < new Date())
    throw new Error("Code has expired. Request a new one.");

  const otpValid = await bcrypt.compare(otp, user.signinOtp);
  if (!otpValid) {
    const attempts = (user.signinOtpAttempts ?? 0) + 1;
    if (attempts >= 5) {
      await updateUser(user.id, { signinOtp: null, signinOtpExpiry: null, signinOtpAttempts: 0 });
      throw new Error("Too many incorrect attempts. Request a new code.");
    }
    await updateUser(user.id, { signinOtpAttempts: attempts });
    throw new Error("Incorrect code.");
  }

  await updateUser(user.id, { signinOtp: null, signinOtpExpiry: null, signinOtpAttempts: 0 });
}

export async function forgotPassword(email: string) {
  const user = await findUserByEmail(email);
  // #18 — always return the same response regardless of whether email exists
  if (!user) return;

  const otp = generateOtp();
  // #16 — hash the OTP before storing; plaintext OTP is only emailed, never stored
  const otpHash = await bcrypt.hash(otp, 10);
  const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min
  await updateUser(user.id, { resetOtp: otpHash, resetOtpExpiry: expiry });

  await sendPasswordResetEmail(user.email, otp);
}

export async function resetPassword(data: ResetPasswordBody) {
  const { email, otp, newPassword } = data;
  // #14 — minimum password length 8
  if (newPassword.length < 8)
    throw new Error("Password must be at least 8 characters.");

  const user = await findUserByEmail(email);
  if (!user || !user.resetOtp || !user.resetOtpExpiry)
    throw new Error("Invalid or expired OTP.");

  // #16 — compare OTP against bcrypt hash
  const otpValid = await bcrypt.compare(otp, user.resetOtp);
  if (!otpValid || user.resetOtpExpiry < new Date())
    throw new Error("Invalid or expired OTP.");

  // #13 — bcrypt cost 12
  const passwordHash = await bcrypt.hash(newPassword, 12);
  await updateUser(user.id, {
    passwordHash,
    resetOtp: null,
    resetOtpExpiry: null,
    refreshToken: null, // invalidate sessions (#10)
  });
}

export async function setup2fa(userId: string) {
  const user = await findUserById(userId);
  if (!user) throw new Error("User not found.");
  if (user.twoFactorEnabled) throw new Error("2FA is already enabled.");

  const secret = speakeasy.generateSecret({
    name: `VaultShare (${user.email})`,
    length: 20,
  });

  await updateUser(user.id, { twoFactorSecret: secret.base32 });
  const otpauthUrl = secret.otpauth_url ?? "";
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

  return { qrCode: qrCodeDataUrl, secret: secret.base32, otpauthUrl };
}

export async function verify2fa(userId: string, token: string) {
  const user = await findUserById(userId);
  if (!user || !user.twoFactorSecret) throw new Error("Run /2fa/setup first.");

  const valid = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: "base32",
    token,
    window: 1,
  });

  if (!valid) throw new Error("Invalid TOTP code. Try again.");
  await updateUser(user.id, { twoFactorEnabled: true });
}

export async function validate2fa(tempToken: string, token: string) {
  let decoded: TempTokenPayload;
  try {
    decoded = jwt.verify(tempToken, TEMP_SECRET) as TempTokenPayload;
  } catch {
    throw new Error("Temp token invalid or expired.");
  }

  const user = await findUserById(decoded.id);
  if (!user || !user.twoFactorSecret || !user.twoFactorEnabled) {
    throw new Error("2FA not set up for this account.");
  }

  // Fix #2 — TOTP replay: reject a code that was already accepted in this 30-second window
  const now = new Date();
  if (
    user.lastUsedTotpCode === token &&
    user.lastUsedTotpAt &&
    now.getTime() - user.lastUsedTotpAt.getTime() < 30_000
  ) {
    throw new Error("This code has already been used. Please wait for the next code.");
  }

  const valid = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: "base32",
    token,
    window: 1,
  });

  if (!valid) throw new Error("Invalid TOTP code.");

  await updateUser(user.id, { lastUsedTotpCode: token, lastUsedTotpAt: now });

  const userPayload: UserPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    twoFactorEnabled: true,
  };
  const accessToken = issueAccessToken(userPayload);
  const refreshToken = issueRefreshToken(userPayload);
  await updateUser(user.id, { refreshToken: hashRefreshToken(refreshToken) });

  return { user, accessToken, refreshToken };
}

export async function disable2fa(userId: string, token: string) {
  const user = await findUserById(userId);
  if (!user || !user.twoFactorEnabled) throw new Error("2FA is not enabled.");

  const valid = speakeasy.totp.verify({
    secret: user.twoFactorSecret!,
    encoding: "base32",
    token,
    window: 1,
  });

  if (!valid) throw new Error("Invalid TOTP code. Cannot disable 2FA.");
  // Fix #3 — revoke active sessions so any hijacked session is immediately evicted
  await updateUser(user.id, {
    twoFactorEnabled: false,
    twoFactorSecret: null,
    lastUsedTotpCode: null,
    lastUsedTotpAt: null,
    refreshToken: null,
  });
}
