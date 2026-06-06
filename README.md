# VaultShare Backend

Express + TypeScript REST API for VaultShare — handles authentication, JWT session management, two-factor authentication, and password reset via email OTP.

## Stack

- **Node.js** + **Express** + **TypeScript**
- **bcryptjs** — password hashing
- **jsonwebtoken** — access tokens, refresh tokens, and 2FA temp tokens
- **speakeasy** + **qrcode** — TOTP-based two-factor authentication
- **nodemailer** — email OTP delivery (Gmail SMTP or dev console fallback)
- **cors** + **dotenv**

## Getting Started

```bash
npm install

# Copy and fill in env vars
cp .env.example .env

npm run dev       # Development with ts-node + nodemon
npm run build     # Compile to dist/
npm start         # Run compiled output
```

## Environment Variables

Copy `.env.example` to `.env` and fill in your values:

```env
PORT=5001
NODE_ENV=development

# JWT secrets — use long random strings in production
JWT_SECRET=your_jwt_secret_here
REFRESH_SECRET=your_refresh_secret_here
TEMP_SECRET=your_temp_secret_here

# Frontend URL(s) for CORS — comma-separated if multiple
CORS_ORIGIN=http://localhost:5173,http://localhost:4173

# Gmail SMTP — create an App Password at myaccount.google.com/apppasswords
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_gmail@gmail.com
SMTP_PASS=your_16_char_app_password
```

> **Dev mode:** If `SMTP_HOST` is not set, emails are not sent — the OTP is printed to the terminal and also returned in the API response as `devOtp`.

## API Endpoints

### Auth

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/auth/signup` | Public | Register a new user |
| `POST` | `/api/auth/signin` | Public | Sign in, receive JWT (or 2FA temp token) |
| `POST` | `/api/auth/refresh` | Public | Exchange refresh token for new access token |
| `POST` | `/api/auth/logout` | Bearer JWT | Invalidate refresh token |
| `GET` | `/api/auth/me` | Bearer JWT | Get current user info (reads from DB) |

### Password Reset

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/auth/forgot-password` | Public | Send OTP to email |
| `POST` | `/api/auth/reset-password` | Public | Reset password using OTP |

### Two-Factor Authentication

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/auth/2fa/setup` | Bearer JWT | Generate QR code + secret |
| `POST` | `/api/auth/2fa/verify` | Bearer JWT | Verify TOTP code to enable 2FA |
| `POST` | `/api/auth/2fa/validate` | Public | Validate TOTP during login (exchanges temp token for full JWT) |
| `DELETE` | `/api/auth/2fa/disable` | Bearer JWT | Disable 2FA using TOTP code |

### Health

| Method | Route | Description |
|--------|-------|-------------|
| `GET` | `/health` | Health check |

## Project Structure

```
src/
├── controllers/
│   └── auth.controller.ts    # Route handlers
├── db/
│   └── inMemoryStore.ts      # In-memory user store (swap for DB in production)
├── middleware/
│   └── auth.ts               # JWT authentication middleware
├── routes/
│   └── auth.ts               # /api/auth route definitions
├── services/
│   └── auth.service.ts       # Business logic (signup, signin, 2FA, password reset)
├── types/
│   └── index.ts              # Shared TypeScript interfaces
├── utils/
│   ├── email.ts              # Nodemailer email sender
│   └── uuid.ts               # UUID generator
├── app.ts                    # Express app + middleware setup
└── server.ts                 # Entry point
```

> **Note:** The current implementation uses an in-memory store. Data resets on server restart. Replace `src/db/inMemoryStore.ts` with a real database (MongoDB, PostgreSQL, etc.) for production.
