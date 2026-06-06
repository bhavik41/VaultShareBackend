/**
 * Simple in-memory user store.
 * Replace with a real database (MongoDB, PostgreSQL, etc.) for production.
 */

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
}

const users: Map<string, StoredUser> = new Map()

export const findUserByEmail = (email: string): StoredUser | undefined => {
  for (const user of users.values()) {
    if (user.email.toLowerCase() === email.toLowerCase()) return user
  }
  return undefined
}

export const findUserById = (id: string): StoredUser | undefined => {
  return users.get(id)
}

export const findUserByRefreshToken = (token: string): StoredUser | undefined => {
  for (const user of users.values()) {
    if (user.refreshToken === token) return user
  }
  return undefined
}

export const createUser = (user: StoredUser): StoredUser => {
  users.set(user.id, user)
  return user
}

export const updateUser = (id: string, updates: Partial<StoredUser>): StoredUser | undefined => {
  const user = users.get(id)
  if (!user) return undefined
  const updated = { ...user, ...updates }
  users.set(id, updated)
  return updated
}

export const getAllUsers = (): StoredUser[] => {
  return Array.from(users.values())
}
