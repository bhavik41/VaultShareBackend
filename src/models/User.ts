import { Schema, model } from 'mongoose'

export interface IUser {
  _id: string
  name: string
  email: string
  passwordHash: string
  createdAt: Date
  refreshToken: string | null
  twoFactorSecret: string | null
  twoFactorEnabled: boolean
  // TOTP replay prevention — track the last verified code + timestamp
  lastUsedTotpCode: string | null
  lastUsedTotpAt: Date | null
  resetOtp: string | null
  resetOtpExpiry: Date | null
  // Email OTP for signin
  signinOtp: string | null
  signinOtpExpiry: Date | null
  signinOtpAttempts: number
  // Account lockout
  failedLoginAttempts: number
  lockoutUntil: Date | null
  // Email verification — false until OTP confirmed after signup
  emailVerified: boolean
}

const userSchema = new Schema<IUser>({
  _id: { type: String },
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true },
  createdAt: { type: Date, default: () => new Date() },
  refreshToken: { type: String, default: null },
  twoFactorSecret: { type: String, default: null },
  twoFactorEnabled: { type: Boolean, default: false },
  lastUsedTotpCode: { type: String, default: null },
  lastUsedTotpAt: { type: Date, default: null },
  resetOtp: { type: String, default: null },
  resetOtpExpiry: { type: Date, default: null },
  signinOtp: { type: String, default: null },
  signinOtpExpiry: { type: Date, default: null },
  signinOtpAttempts: { type: Number, default: 0 },
  failedLoginAttempts: { type: Number, default: 0 },
  lockoutUntil: { type: Date, default: null },
  // Existing users without this field default to true (already verified)
  emailVerified: { type: Boolean, default: true },
})

export const UserModel = model<IUser>('User', userSchema)
