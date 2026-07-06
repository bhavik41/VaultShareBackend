/**
 * Test-only routes — never mounted in production.
 * Used by Playwright e2e tests to get a real auth token without going
 * through the email-OTP flow that automated tests can't complete.
 */
import { Router } from "express";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { findUserByEmail, createUser, updateUser } from "../db/inMemoryStore";
import { issueAccessToken, issueRefreshToken } from "../services/auth.service";

const router = Router();

router.post("/session", async (req, res) => {
  try {
    const { email, name, password = "E2EPass123!" } = req.body as {
      email: string;
      name?: string;
      password?: string;
    };
    if (!email) {
      res.status(400).json({ message: "email required" });
      return;
    }

    let user = await findUserByEmail(email);

    if (!user) {
      const passwordHash = await bcrypt.hash(password, 4);
      user = await createUser({
        id: uuidv4(),
        name: name ?? email.split("@")[0],
        email: email.toLowerCase(),
        passwordHash,
        createdAt: new Date(),
        refreshToken: null,
        twoFactorSecret: null,
        twoFactorEnabled: false,
        resetOtp: null,
        resetOtpExpiry: null,
        signinOtp: null,
        signinOtpExpiry: null,
        failedLoginAttempts: 0,
        lockoutUntil: null,
      });
    }

    const payload = {
      id: user.id,
      email: user.email,
      name: user.name,
      twoFactorEnabled: user.twoFactorEnabled,
    };

    const token        = issueAccessToken(payload);
    const refreshToken = issueRefreshToken(payload);

    await updateUser(user.id, { refreshToken });

    res.json({
      token,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt },
    });
  } catch (err) {
    console.error("[test/session]", err);
    res.status(500).json({ message: "Internal error" });
  }
});

export default router;
