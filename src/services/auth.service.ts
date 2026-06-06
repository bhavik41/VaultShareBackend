import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import speakeasy from "speakeasy"
import QRCode from "qrcode"
import crypto from "crypto"
import { v4 as uuidv4 } from "../utils/uuid.js"
import {
  findUserByEmail,
  findUserById,
  findUserByRefreshToken,
  createUser,
  updateUser,
} from "../db/inMemoryStore.js"
import type {
  SignupBody,
  SigninBody,
  ResetPasswordBody,
  UserPayload,
  TempTokenPayload,
} from "../types/index.js"
import { sendPasswordResetEmail } from "../utils/email.js"

const JWT_SECRET = () => process.env.JWT_SECRET as string
const REFRESH_SECRET = () => (process.env.REFRESH_SECRET ?? process.env.JWT_SECRET) as string
const TEMP_SECRET = () => (process.env.TEMP_SECRET ?? process.env.JWT_SECRET) as string

export function issueAccessToken(payload: UserPayload): string {
  return jwt.sign(payload, JWT_SECRET(), { expiresIn: "15m" })
}

export function issueRefreshToken(payload: UserPayload): string {
  return jwt.sign(payload, REFRESH_SECRET(), { expiresIn: "7d" })
}

export function issueTempToken(payload: TempTokenPayload): string {
  return jwt.sign(payload, TEMP_SECRET(), { expiresIn: "5m" })
}

function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString()
}

export async function signup(data: SignupBody) {
  const { name, email, password } = data
  if (password.length < 6) throw new Error("Password must be at least 6 characters.")
  
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) throw new Error("Invalid email address.")
  
  if (findUserByEmail(email)) throw new Error("An account with this email already exists.")

  const passwordHash = await bcrypt.hash(password, 12)
  const newUser = createUser({
    id: uuidv4(),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash,
    createdAt: new Date(),
    refreshToken: null,
    twoFactorSecret: null,
    twoFactorEnabled: false,
    resetOtp: null,
    resetOtpExpiry: null,
  })

  const userPayload: UserPayload = {
    id: newUser.id,
    email: newUser.email,
    name: newUser.name,
    twoFactorEnabled: false,
  }

  const accessToken = issueAccessToken(userPayload)
  const refreshToken = issueRefreshToken(userPayload)
  updateUser(newUser.id, { refreshToken })

  return { user: newUser, accessToken, refreshToken }
}

export async function signin(data: SigninBody) {
  const { email, password } = data
  const user = findUserByEmail(email)
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
    throw new Error("Invalid email or password.")
  }

  if (user.twoFactorEnabled) {
    const tempToken = issueTempToken({ id: user.id, requires2fa: true })
    return { requires2fa: true, tempToken }
  }

  const userPayload: UserPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    twoFactorEnabled: user.twoFactorEnabled,
  }
  const accessToken = issueAccessToken(userPayload)
  const refreshToken = issueRefreshToken(userPayload)
  updateUser(user.id, { refreshToken })

  return { requires2fa: false, user, accessToken, refreshToken }
}

export function refresh(refreshToken: string) {
  let decoded: UserPayload
  try {
    decoded = jwt.verify(refreshToken, REFRESH_SECRET()) as UserPayload
  } catch {
    throw new Error("Invalid or expired refresh token.")
  }

  const user = findUserByRefreshToken(refreshToken)
  if (!user || user.id !== decoded.id) {
    throw new Error("Refresh token revoked or not found.")
  }

  const userPayload: UserPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    twoFactorEnabled: user.twoFactorEnabled,
  }
  const newAccessToken = issueAccessToken(userPayload)
  const newRefreshToken = issueRefreshToken(userPayload)
  updateUser(user.id, { refreshToken: newRefreshToken })

  return { newAccessToken, newRefreshToken }
}

export function logout(userId: string) {
  updateUser(userId, { refreshToken: null })
}

export async function forgotPassword(email: string) {
  const user = findUserByEmail(email)
  if (!user) return { otp: null } // Return generic success later to avoid enum

  const otp = generateOtp()
  const expiry = new Date(Date.now() + 10 * 60 * 1000) // 10 min
  updateUser(user.id, { resetOtp: otp, resetOtpExpiry: expiry })

  await sendPasswordResetEmail(user.email, otp)
  return { otp }
}

export async function resetPassword(data: ResetPasswordBody) {
  const { email, otp, newPassword } = data
  if (newPassword.length < 6) throw new Error("Password must be at least 6 characters.")

  const user = findUserByEmail(email)
  if (!user || !user.resetOtp || !user.resetOtpExpiry) throw new Error("Invalid or expired OTP.")
  if (user.resetOtp !== otp || user.resetOtpExpiry < new Date()) throw new Error("Invalid or expired OTP.")

  const passwordHash = await bcrypt.hash(newPassword, 12)
  updateUser(user.id, {
    passwordHash,
    resetOtp: null,
    resetOtpExpiry: null,
    refreshToken: null, // invalidate sessions
  })
}

export async function setup2fa(userId: string) {
  const user = findUserById(userId)
  if (!user) throw new Error("User not found.")
  if (user.twoFactorEnabled) throw new Error("2FA is already enabled.")

  const secret = speakeasy.generateSecret({
    name: `VaultShare (${user.email})`,
    length: 20,
  })

  updateUser(user.id, { twoFactorSecret: secret.base32 })
  const otpauthUrl = secret.otpauth_url ?? ""
  const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl)

  return { qrCode: qrCodeDataUrl, secret: secret.base32, otpauthUrl }
}

export function verify2fa(userId: string, token: string) {
  const user = findUserById(userId)
  if (!user || !user.twoFactorSecret) throw new Error("Run /2fa/setup first.")

  const valid = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: "base32",
    token,
    window: 1,
  })

  if (!valid) throw new Error("Invalid TOTP code. Try again.")
  updateUser(user.id, { twoFactorEnabled: true })
}

export function validate2fa(tempToken: string, token: string) {
  let decoded: TempTokenPayload
  try {
    decoded = jwt.verify(tempToken, TEMP_SECRET()) as TempTokenPayload
  } catch {
    throw new Error("Temp token invalid or expired.")
  }

  const user = findUserById(decoded.id)
  if (!user || !user.twoFactorSecret || !user.twoFactorEnabled) {
    throw new Error("2FA not set up for this account.")
  }

  const valid = speakeasy.totp.verify({
    secret: user.twoFactorSecret,
    encoding: "base32",
    token,
    window: 1,
  })

  if (!valid) throw new Error("Invalid TOTP code.")

  const userPayload: UserPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
    twoFactorEnabled: true,
  }
  const accessToken = issueAccessToken(userPayload)
  const refreshToken = issueRefreshToken(userPayload)
  updateUser(user.id, { refreshToken })

  return { user, accessToken, refreshToken }
}

export function disable2fa(userId: string, token: string) {
  const user = findUserById(userId)
  if (!user || !user.twoFactorEnabled) throw new Error("2FA is not enabled.")

  const valid = speakeasy.totp.verify({
    secret: user.twoFactorSecret!,
    encoding: "base32",
    token,
    window: 1,
  })

  if (!valid) throw new Error("Invalid TOTP code. Cannot disable 2FA.")
  updateUser(user.id, { twoFactorEnabled: false, twoFactorSecret: null })
}
