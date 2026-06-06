import { Router, Request, Response } from "express"
import bcrypt from "bcryptjs"
import jwt from "jsonwebtoken"
import { v4 as uuidv4 } from "../utils/uuid.js"
import { findUserByEmail, createUser } from "../db/inMemoryStore.js"
import { SignupBody, SigninBody, UserPayload } from "../types/index.js"
import { authenticate } from "../middleware/auth.js"

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

// ── POST /api/auth/signin ─────────────────────────────────────────────────────
router.post("/signin", async (req: Request<object, object, SigninBody>, res: Response): Promise<void> => {
  const { email, password } = req.body

  if (!email || !password) {
    res.status(400).json({ message: "Email and password are required." })
    return
  }

  const user = findUserByEmail(email)
  if (!user) {
    res.status(401).json({ message: "Invalid email or password." })
    return
  }

  const isValid = await bcrypt.compare(password, user.passwordHash)
  if (!isValid) {
    res.status(401).json({ message: "Invalid email or password." })
    return
  }

  const payload: UserPayload = {
    id: user.id,
    email: user.email,
    name: user.name,
  }

  const token = jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: "7d",
  })

  res.status(200).json({
    message: "Signed in successfully.",
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
    },
  })
})

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get("/me", authenticate, (req: Request, res: Response): void => {
  res.status(200).json({ user: req.user })
})

export default router
