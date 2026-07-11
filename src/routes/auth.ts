import { Router } from "express";
import { AuthController } from "../controllers/auth.controller";
import { authenticate } from "../middleware/auth";
import {
  signinLimiter,
  signupLimiter,
  forgotPasswordLimiter,
  twoFaLimiter,
  refreshLimiter,
} from "../middleware/rateLimiter";

const router = Router();

// #1 / #4 — rate-limited public auth routes
router.post("/signup", signupLimiter, AuthController.signup);
router.post("/signin", signinLimiter, AuthController.signin);
router.post("/signin/verify-otp", signinLimiter, AuthController.verifySigninOtp);
router.post("/refresh", refreshLimiter, AuthController.refresh);
router.post("/logout", authenticate, AuthController.logout);
router.get("/me", authenticate, AuthController.me);

// #2 — rate-limited password-reset routes
router.post("/forgot-password", forgotPasswordLimiter, AuthController.forgotPassword);
router.post("/reset-password", AuthController.resetPassword);

// #3 — rate-limited 2FA routes
router.post("/2fa/setup", twoFaLimiter, authenticate, AuthController.setup2fa);
router.post("/2fa/verify", twoFaLimiter, authenticate, AuthController.verify2fa);
router.post("/2fa/validate", twoFaLimiter, AuthController.validate2fa);
router.delete("/2fa/disable", twoFaLimiter, authenticate, AuthController.disable2fa);

export default router;
