# Architecture Overview

VaultShare's backend is an Express + TypeScript REST API backed by MongoDB (Mongoose) and AWS S3, with a Socket.IO layer for real-time per-file chat. It handles authentication (JWT + TOTP 2FA + email OTP), file storage with versioning and an approval workflow, direct/group/link-based collaboration, per-file audit logging, and a BM25-based document Q&A feature.

See also: [API Reference](api-reference.md) · [Services Layer](services.md) · [Data Model](data-model.md) · [Middleware & Security](security-middleware.md) · [Real-Time Chat](realtime-chat.md) · [Deployment & Testing](testing-deployment.md)

## Tech stack

| Concern | Library |
|---|---|
| Framework | Express 4 + TypeScript 5.7 |
| Database | MongoDB via Mongoose 9 |
| Object storage | AWS S3 (`@aws-sdk/client-s3` + presigner) |
| Auth | `jsonwebtoken` (JWT), `bcryptjs` (password/OTP hashing), `speakeasy`+`qrcode` (TOTP 2FA) |
| Real-time | `socket.io` 4.8 |
| Email | `resend` (primary) → `nodemailer`/SMTP (fallback) → console log (dev) |
| File handling | `multer` (memory storage), `file-type`/custom magic-byte sniffing, ClamAV via shell-out (optional) |
| Document Q&A | Hand-rolled BM25 retrieval + `pdf-parse`/`mammoth` extraction + NVIDIA-hosted Llama 3.1 (via the `openai` SDK shape) |
| Preview conversion | `libreoffice-convert` (PPTX → PDF) |
| Testing | Jest 29 + `ts-jest` + `supertest` |
| Process management | PM2 (`ecosystem.config.js`), Docker (`node:20-alpine`) |

## Project structure

```
src/
├── app.ts                # Express app: helmet, CORS, body parsing, route mounting
├── server.ts              # Entry point: HTTP server, Socket.IO init, DB connect
├── config/s3.ts           # S3 client + bucket/region config
├── controllers/           # 8 files — request handlers
├── db/                    # 10 files — Mongoose-backed store modules (repository pattern)
├── middleware/            # 8 files — auth, permissions, rate limiting, upload, virus scan
├── models/                # 11 Mongoose schemas
├── routes/                # 14 files — Express route definitions
├── services/              # 9 files — business logic
├── socketio/               # Real-time chat server (index, handlers, room manager)
├── types/                 # Shared TypeScript interfaces
├── utils/                 # accessControl (RBAC), auditLogger, email, uuid
└── scripts/testChat.ts    # Manual usage reference for the socket API (not executable)
```

Layering is consistent throughout: **routes** wire HTTP verbs/paths to **controllers**, which validate the request shape and call into **services**, which hold business rules and call **db store modules**, which are thin Mongoose wrappers around **models**. Two exceptions worth knowing: `documentAI.ts`, `previewPdf.ts`, and `starred.ts` skip the controller layer and call services/models inline; and several route files' *own controllers* embed permission checks inline rather than via middleware (see [api-reference.md](api-reference.md)).

## Request flow

`server.ts` creates one `http.Server`, attaches both the Express `app` and `initSocketIO` to it, then connects to MongoDB before listening. Global middleware in `app.ts`: `helmet` (CSP, HSTS, frameguard-deny, referrer-policy), a CORS allowlist from `CORS_ORIGIN`, `express.json({limit:"10kb"})`, and a request logger. `trust proxy` is set to `1` so `express-rate-limit` and Express's own `req.ip` resolve the real client IP behind one reverse-proxy hop.

Authentication and authorization are two separate, composable middleware layers:
- **`authenticate`** (`middleware/auth.ts`) — verifies the JWT (HS256-only) and attaches `req.user`.
- **`requirePermission(action)`** (`middleware/permissions.ts`) — resolves the caller's role for a `:fileId` via `utils/accessControl.ts` and gates the route by `view`/`edit`/`download`/`owner` rank.

Full detail on the permission model, rate limiting, upload validation, and virus scanning is in [security-middleware.md](security-middleware.md).

## Data layer

MongoDB via Mongoose, 11 schemas, all keyed by app-generated UUID strings (not `ObjectId`s) with no `ref`/`populate` — cross-model relationships are plain string foreign keys resolved manually in the store layer. Every domain has a `db/*Store.ts` repository wrapper **except** the naming is misleading in one case: `db/inMemoryStore.ts` is not actually in-memory — it's a full Mongoose wrapper around the `User` model (see [Known issues](#known-issues--inconsistencies)). The one genuinely in-memory piece of state is chat presence (`chatStore.ts`'s online-user map), which is intentionally ephemeral per-process socket state. Full schema/store breakdown in [data-model.md](data-model.md).

## Real-time layer

A single Socket.IO server, JWT-authenticated at the handshake (same HS256 verification as REST), with a per-IP connection rate limit. One room per file (`fileId`); presence and typing state live in-memory (per-process, not coordinated across instances). Full event contract and admin-only-chat trace in [realtime-chat.md](realtime-chat.md).

## Security posture

JWT access/refresh/temp tokens (15m/7d/5m, distinct secrets), bcrypt password hashing (cost 12) and OTP hashing, TOTP 2FA with replay protection, account lockout after 5 failed signins, refresh-token-reuse detection (revokes all sessions), anti-enumeration on password reset, Multer memory-storage uploads with a MIME allowlist + magic-byte verification, optional real ClamAV scanning, and per-domain audit logging with a 90-day Mongo TTL. Full detail, including several gaps found during this pass, in [security-middleware.md](security-middleware.md).

## Known issues & inconsistencies

Found during this documentation pass — worth triaging, not blockers:

- **`SECURITY_IMPLEMENTATION.md`/`README.md` describe a stale architecture.** The README still says `db/inMemoryStore.ts` is "the current implementation," an in-memory store that "resets on server restart" — it's actually a full MongoDB/Mongoose wrapper around the `User` model (7 live import sites: auth, dashboard, audit, group, collaboration, and version services, plus the test-session route). The filename and the doc are both leftover from a pre-Mongo prototype.
- **Duplicate/legacy route surfaces**: `GET /api/audit/my-activity` and `GET /api/activity/my-activity` call the exact same controller function — `/api/activity` is a redundant, likely-legacy duplicate (it's missing `/api/audit`'s `/stats` endpoint). Similarly, `routes/collaboration.ts` has two overlapping generations of invite/share/role/revoke endpoints doing the same jobs under different paths (documented in [api-reference.md](api-reference.md)).
- **Dead validation middleware**: `middleware/auditValidation.ts` (`validateAuditQuery`, `validateDateRangeQuery`) is never wired into `routes/audit.ts` — audit query params (`limit`, `offset`, `action`) go completely unbounded/unvalidated in practice, and the middleware's own `AUDIT_ACTIONS` allowlist is stale against the model's 15-value enum (missing all 6 `version_*` actions).
- **Dead code**: `chat.service.ts`'s `clearRoom()` is never called (not wired into file deletion); `scripts/testChat.ts` is a reference comment block, not an executable script.
- **Chat REST reads have no file-permission check**: `GET /api/chat/:fileId/messages` and `/online` only require *a* valid JWT — any authenticated user who knows a `fileId` can read its chat history/presence regardless of file access. (Posting is presumably safe since the Socket.IO layer re-validates on `send_message`, but these two REST reads bypass `requirePermission` entirely.)
- **Two parallel UUID generators**: `utils/uuid.ts` (wraps `crypto.randomUUID()`) is used by only 4 files; everything else imports the `uuid` npm package's `v4()` directly. Functionally identical, just redundant.
- **Unused cloud/AI dependencies**: `@google-cloud/storage`, `@anthropic-ai/sdk`, and `@google/generative-ai` are all in `package.json` but never imported anywhere in `src/`. Storage is exclusively AWS S3; the "Ask AI" feature is a hand-rolled BM25 keyword-retrieval pipeline (no embeddings/vector DB) that calls **NVIDIA's hosted Llama 3.1** through the `openai` SDK's HTTP client shape — not OpenAI's own models.
- **`shareLink.ts` JWT verification skips the `algorithms: ["HS256"]` pin** that `middleware/auth.ts` uses elsewhere — lower defense-in-depth for share-link unlock/admin-download tokens, though the practical risk is limited since it's a symmetric secret, not an asymmetric key pair.
- **Audit-trail IP attribution gap**: `utils/auditLogger.ts` manually parses `X-Forwarded-For` and trusts the **first** (client-controllable) entry, rather than Express's own trust-proxy-aware `req.ip`. A client behind the one trusted proxy hop can spoof the IP recorded in the audit log. Separately, `AuditLog`'s dedicated top-level `ipAddress`/`userAgent` schema fields are never populated by `createAuditLog` (data actually lands under `metadata.*`, and some call sites like the star-file audit log pass no metadata at all).
- **No time-windowed rate limiting on file routes**: `middleware/rateLimiter.ts`'s six limiters are only ever applied to `routes/auth.ts`. Upload/download/share-link endpoints rely solely on `uploadThrottle.ts`'s in-memory, per-instance concurrency cap (3 concurrent uploads/user) — no coordination across multiple app instances, and no cap at all on download/share-link request rate.
- **Virus scanning is real but fully opt-in**: `middleware/virusScan.ts` genuinely shells out to a `clamscan` CLI (not a stub), but is gated behind `ENABLE_VIRUS_SCAN` and fails open (allows the upload) by default if the scanner is unavailable — only `VIRUS_SCAN_STRICT=true` fails closed. Whether uploads are actually scanned in a given deployment is a config question, not something guaranteed by code presence.
- **`.env.example` is incomplete**: `RESEND_API_KEY`/`RESEND_FROM` (the first-priority email path in `utils/email.ts`) aren't documented there, only the SMTP fallback vars are.
- **`mongoose.ts` has no reconnect/backoff logic or connection-error listeners** — a dropped connection after initial startup isn't retried or explicitly handled.
