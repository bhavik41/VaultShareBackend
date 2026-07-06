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
  // Password reset
  resetOtp: string | null
  resetOtpExpiry: Date | null
  // Email OTP for signin
  signinOtp: string | null
  signinOtpExpiry: Date | null
  // Account lockout (#5)
  failedLoginAttempts: number
  lockoutUntil: Date | null
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
    resetOtp: doc.resetOtp,
    resetOtpExpiry: doc.resetOtpExpiry,
    signinOtp: doc.signinOtp ?? null,
    signinOtpExpiry: doc.signinOtpExpiry ?? null,
    failedLoginAttempts: doc.failedLoginAttempts ?? 0,
    lockoutUntil: doc.lockoutUntil ?? null,
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

export const findUserByRefreshToken = async (token: string): Promise<StoredUser | undefined> => {
  const doc = await UserModel.findOne({ refreshToken: token }).lean()
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
    resetOtp: user.resetOtp,
    resetOtpExpiry: user.resetOtpExpiry,
    signinOtp: user.signinOtp,
    signinOtpExpiry: user.signinOtpExpiry,
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

export const getAllUsers = async (): Promise<StoredUser[]> => {
  const docs = await UserModel.find().lean()
  return docs.map(toStoredUser)
}
