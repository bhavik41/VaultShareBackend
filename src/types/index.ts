export interface UserPayload {
  id: string
  email: string
  name: string
  twoFactorEnabled?: boolean
}

// Temporary payload issued when 2FA is required before full login
export interface TempTokenPayload {
  id: string
  requires2fa: true
}

export interface SignupBody {
  name: string
  email: string
  password: string
  username?: string
  role?: string
}

export interface SigninBody {
  email: string
  password: string
}

export interface RefreshBody {
  refreshToken: string
}

export interface ForgotPasswordBody {
  email: string
}

export interface ResetPasswordBody {
  email: string
  otp: string
  newPassword: string
}

export interface Verify2FABody {
  token: string // TOTP code from authenticator app
}

export interface Validate2FABody {
  tempToken: string
  token: string // TOTP code
}
