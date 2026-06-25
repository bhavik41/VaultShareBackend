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
  resetOtp: string | null
  resetOtpExpiry: Date | null
  // Account lockout (#5)
  failedLoginAttempts: number
  lockoutUntil: Date | null
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
  resetOtp: { type: String, default: null },
  resetOtpExpiry: { type: Date, default: null },
  // Account lockout (#5)
  failedLoginAttempts: { type: Number, default: 0 },
  lockoutUntil: { type: Date, default: null },
})

export const UserModel = model<IUser>('User', userSchema)
