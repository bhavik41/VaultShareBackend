import rateLimit from "express-rate-limit";

const rateLimitMessage = (action: string) => ({
  message: `Too many ${action} attempts. Please try again later.`,
});

/** #1 — Sign-in: 10 requests / 15 min per IP */
export const signinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage("sign-in"),
});

/** #2 — Forgot-password: 5 requests / hour per IP */
export const forgotPasswordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage("forgot-password"),
});

/** #3 — 2FA endpoints: 10 requests / 15 min per IP */
export const twoFaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage("2FA"),
});

/** #4 — Sign-up: 10 requests / hour per IP — prevent account farming */
export const signupLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage("sign-up"),
});

/** #5 — Refresh token: 30 requests / 15 min per IP */
export const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage("token refresh"),
});

/** Idle-timeout re-authentication: 10 requests / 15 min per IP */
export const reauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: rateLimitMessage("re-authentication"),
});
