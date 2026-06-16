import { Request, Response } from "express";
import * as authService from "../services/auth.service";
import type {
  SignupBody,
  SigninBody,
  RefreshBody,
  ForgotPasswordBody,
  ResetPasswordBody,
  Verify2FABody,
  Validate2FABody,
} from "../types/index";

export class AuthController {
  static async signup(
    req: Request<object, object, SignupBody>,
    res: Response,
  ): Promise<void> {
    try {
      const { name, email, password } = req.body;
      if (!name || !email || !password) {
        res
          .status(400)
          .json({ message: "Name, email, and password are required." });
        return;
      }

      const { user, accessToken, refreshToken } = await authService.signup(
        req.body,
      );
      res.status(201).json({
        message: "Account created successfully.",
        token: accessToken,
        refreshToken,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          createdAt: user.createdAt,
        },
      });
    } catch (error: any) {
      if (error.message.includes("already exists")) {
        res.status(409).json({ message: error.message });
      } else {
        res.status(400).json({ message: error.message });
      }
    }
  }

  static async signin(
    req: Request<object, object, SigninBody>,
    res: Response,
  ): Promise<void> {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        res.status(400).json({ message: "Email and password are required." });
        return;
      }

      const result = await authService.signin(req.body);

      if (result.requires2fa) {
        res
          .status(200)
          .json({ requires2fa: true, tempToken: result.tempToken });
        return;
      }

      res.status(200).json({
        message: "Signed in successfully.",
        token: result.accessToken,
        refreshToken: result.refreshToken,
        user: {
          id: result.user!.id,
          name: result.user!.name,
          email: result.user!.email,
          createdAt: result.user!.createdAt,
        },
      });
    } catch (error: any) {
      res.status(401).json({ message: error.message });
    }
  }

  static async refresh(
    req: Request<object, object, RefreshBody>,
    res: Response,
  ): Promise<void> {
    try {
      const { refreshToken } = req.body;
      if (!refreshToken) {
        res.status(400).json({ message: "Refresh token required." });
        return;
      }

      const { newAccessToken, newRefreshToken } =
        await authService.refresh(refreshToken);
      res
        .status(200)
        .json({ token: newAccessToken, refreshToken: newRefreshToken });
    } catch (error: any) {
      res.status(401).json({ message: error.message });
    }
  }

  static async logout(req: Request, res: Response): Promise<void> {
    if (req.user) await authService.logout(req.user.id);
    res.status(200).json({ message: "Logged out successfully." });
  }

  static async me(req: Request, res: Response): Promise<void> {
    try {
      const user = await authService.getMe(req.user!.id);
      res.status(200).json({ user });
    } catch (error: any) {
      res.status(404).json({ message: error.message });
    }
  }

  static async forgotPassword(
    req: Request<object, object, ForgotPasswordBody>,
    res: Response,
  ): Promise<void> {
    try {
      const { email } = req.body;
      if (!email) {
        res.status(400).json({ message: "Email is required." });
        return;
      }

      const { otp } = await authService.forgotPassword(email);

      res.status(200).json({
        message: "If that email exists, an OTP has been sent.",
        ...(process.env.NODE_ENV !== "production" && otp
          ? { devOtp: otp }
          : {}),
      });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  static async resetPassword(
    req: Request<object, object, ResetPasswordBody>,
    res: Response,
  ): Promise<void> {
    try {
      const { email, otp, newPassword } = req.body;
      if (!email || !otp || !newPassword) {
        res
          .status(400)
          .json({ message: "Email, OTP, and new password are required." });
        return;
      }

      await authService.resetPassword(req.body);
      res
        .status(200)
        .json({
          message: "Password reset successfully. Please sign in again.",
        });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  static async setup2fa(req: Request, res: Response): Promise<void> {
    try {
      const result = await authService.setup2fa(req.user!.id);
      res.status(200).json({
        message:
          "Scan the QR code with your authenticator app, then call /2fa/verify.",
        ...result,
      });
    } catch (error: any) {
      const status = error.message.includes("not found") ? 404 : 400;
      res.status(status).json({ message: error.message });
    }
  }

  static async verify2fa(
    req: Request<object, object, Verify2FABody>,
    res: Response,
  ): Promise<void> {
    try {
      const { token } = req.body;
      if (!token) {
        res.status(400).json({ message: "Token is required." });
        return;
      }
      await authService.verify2fa(req.user!.id, token);
      res.status(200).json({ message: "2FA enabled successfully." });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }

  static async validate2fa(
    req: Request<object, object, Validate2FABody>,
    res: Response,
  ): Promise<void> {
    try {
      const { tempToken, token } = req.body;
      if (!tempToken || !token) {
        res
          .status(400)
          .json({ message: "tempToken and TOTP token are required." });
        return;
      }

      const result = await authService.validate2fa(tempToken, token);
      res.status(200).json({
        message: "2FA verified. Signed in successfully.",
        token: result.accessToken,
        refreshToken: result.refreshToken,
        user: {
          id: result.user.id,
          name: result.user.name,
          email: result.user.email,
          createdAt: result.user.createdAt,
        },
      });
    } catch (error: any) {
      const status = error.message.includes("invalid or expired") ? 401 : 400;
      res.status(status).json({ message: error.message });
    }
  }

  static async disable2fa(
    req: Request<object, object, Verify2FABody>,
    res: Response,
  ): Promise<void> {
    try {
      const { token } = req.body;
      if (!token) {
        res.status(400).json({ message: "Token is required." });
        return;
      }
      await authService.disable2fa(req.user!.id, token);
      res.status(200).json({ message: "2FA disabled successfully." });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
}
