# VaultShare Backend

Express + TypeScript REST API for VaultShare authentication.

## Stack

- **Node.js** + **Express** + **TypeScript**
- **bcryptjs** for password hashing
- **jsonwebtoken** for JWT auth
- **cors** + **dotenv**

## API Endpoints

| Method | Route | Auth | Description |
|--------|-------|------|-------------|
| `POST` | `/api/auth/signup` | Public | Register a new user |
| `POST` | `/api/auth/signin` | Public | Sign in, receive JWT |
| `GET` | `/api/auth/me` | Bearer JWT | Get current user info |
| `GET` | `/health` | Public | Health check |

### Signup

```
POST /api/auth/signup
Content-Type: application/json

{ "name": "Alice", "email": "alice@example.com", "password": "secret123" }
```

Returns: `{ token, user: { id, name, email, createdAt } }`

### Signin

```
POST /api/auth/signin
Content-Type: application/json

{ "email": "alice@example.com", "password": "secret123" }
```

Returns: `{ token, user: { id, name, email, createdAt } }`

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

```
PORT=5000
JWT_SECRET=your_jwt_secret_here
NODE_ENV=development
```

> **Note:** The current implementation uses an in-memory store. Data resets on server restart. Replace `src/db/inMemoryStore.ts` with a real database (MongoDB, PostgreSQL, etc.) for production.

## Project Structure

```
src/
├── db/
│   └── inMemoryStore.ts      # In-memory user store (swap for DB)
├── middleware/
│   └── auth.ts               # JWT authentication middleware
├── routes/
│   └── auth.ts               # /api/auth routes
├── types/
│   └── index.ts              # Shared TypeScript types
├── utils/
│   └── uuid.ts               # UUID generator
├── app.ts                    # Express app setup
└── server.ts                 # Entry point
```
