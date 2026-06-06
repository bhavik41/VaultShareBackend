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

export const createUser = (user: StoredUser): StoredUser => {
  users.set(user.id, user)
  return user
}

export const getAllUsers = (): StoredUser[] => {
  return Array.from(users.values())
}
