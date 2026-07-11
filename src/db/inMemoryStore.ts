/**
 * User store backed by MongoDB.
 */
import { UserModel, IUser } from "../models/User"

export interface StoredUser {
  id: string
  name: string
  email: string
  passwordHash: string
  createdAt: Date
  // Session
  refreshToken: string | null
  // 2FA
  twoFactorSecret: string | null
  twoFactorEnabled: boolean
  // TOTP replay prevention
  lastUsedTotpCode: string | null
  lastUsedTotpAt: Date | null
  // Password reset
  resetOtp: string | null
  resetOtpExpiry: Date | null
  // Email OTP for signin
  signinOtp: string | null
  signinOtpExpiry: Date | null
  signinOtpAttempts: number
  // Account lockout
  failedLoginAttempts: number
  lockoutUntil: Date | null
  // Email verification
  emailVerified: boolean
}

function toStoredUser(doc: IUser): StoredUser {
  return {
    id: doc._id,
    name: doc.name,
    email: doc.email,
    passwordHash: doc.passwordHash,
    createdAt: doc.createdAt,
    refreshToken: doc.refreshToken,
    twoFactorSecret: doc.twoFactorSecret,
    twoFactorEnabled: doc.twoFactorEnabled,
    lastUsedTotpCode: doc.lastUsedTotpCode ?? null,
    lastUsedTotpAt: doc.lastUsedTotpAt ?? null,
    resetOtp: doc.resetOtp,
    resetOtpExpiry: doc.resetOtpExpiry,
    signinOtp: doc.signinOtp ?? null,
    signinOtpExpiry: doc.signinOtpExpiry ?? null,
    signinOtpAttempts: doc.signinOtpAttempts ?? 0,
    failedLoginAttempts: doc.failedLoginAttempts ?? 0,
    lockoutUntil: doc.lockoutUntil ?? null,
    emailVerified: doc.emailVerified ?? true,
  }
}

export const findUserByEmail = async (email: string): Promise<StoredUser | undefined> => {
  const doc = await UserModel.findOne({ email: email.toLowerCase() }).lean()
  return doc ? toStoredUser(doc) : undefined
}

export const findUserById = async (id: string): Promise<StoredUser | undefined> => {
  const doc = await UserModel.findById(id).lean()
  return doc ? toStoredUser(doc) : undefined
}

export const findUsersByIds = async (ids: string[]): Promise<StoredUser[]> => {
  const docs = await UserModel.find({ _id: { $in: ids } }).lean()
  return docs.map(toStoredUser)
}

export const findUserByRefreshTokenHash = async (hash: string): Promise<StoredUser | undefined> => {
  const doc = await UserModel.findOne({ refreshToken: hash }).lean()
  return doc ? toStoredUser(doc) : undefined
}

export const createUser = async (user: StoredUser): Promise<StoredUser> => {
  const doc = await UserModel.create({
    _id: user.id,
    name: user.name,
    email: user.email,
    passwordHash: user.passwordHash,
    createdAt: user.createdAt,
    refreshToken: user.refreshToken,
    twoFactorSecret: user.twoFactorSecret,
    twoFactorEnabled: user.twoFactorEnabled,
    lastUsedTotpCode: user.lastUsedTotpCode,
    lastUsedTotpAt: user.lastUsedTotpAt,
    resetOtp: user.resetOtp,
    resetOtpExpiry: user.resetOtpExpiry,
    signinOtp: user.signinOtp,
    signinOtpExpiry: user.signinOtpExpiry,
    signinOtpAttempts: user.signinOtpAttempts,
    emailVerified: user.emailVerified,
  })
  return toStoredUser(doc.toObject())
}

export const updateUser = async (
  id: string,
  updates: Partial<StoredUser>,
): Promise<StoredUser | undefined> => {
  const doc = await UserModel.findByIdAndUpdate(id, updates, { new: true }).lean()
  return doc ? toStoredUser(doc) : undefined
}

export const deleteUser = async (id: string): Promise<void> => {
  await UserModel.deleteOne({ _id: id })
}

export const getAllUsers = async (): Promise<StoredUser[]> => {
  const docs = await UserModel.find().lean()
  return docs.map(toStoredUser)
}
