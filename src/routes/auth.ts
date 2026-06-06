import { Router, Request, Response } from "express"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { v4 as uuidv4 } from "../utils/uuid.js"
import { findUserByEmail, createUser } from "../db/inMemoryStore.js"
import { SignupBody, UserPayload } from "../types/index.js"

const router = Router()

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
router.post("/signup", async (req: Request<object, object, SignupBody>, res: Response): Promise<void> => {
  const { name, email, password } = req.body

  if (!name || !email || !password) {
    res.status(400).json({ message: "Name, email, and password are required." })
    return
  }

  if (password.length < 6) {
    res.status(400).json({ message: "Password must be at least 6 characters." })
    return
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!emailRegex.test(email)) {
    res.status(400).json({ message: "Invalid email address." })
    return
  }

  const existing = findUserByEmail(email)
  if (existing) {
    res.status(409).json({ message: "An account with this email already exists." })
    return
  }

  const salt = await bcrypt.genSalt(12)
  const passwordHash = await bcrypt.hash(password, salt)

  const newUser = createUser({
    id: uuidv4(),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    passwordHash,
    createdAt: new Date(),
  })

  const payload: UserPayload = {
    id: newUser.id,
    email: newUser.email,
    name: newUser.name,
  }

  const token = jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: "7d",
  })

  res.status(201).json({
    message: "Account created successfully.",
    token,
    user: {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      createdAt: newUser.createdAt,
    },
  })
})

export default router
