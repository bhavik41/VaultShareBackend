# Utils, Deployment & Testing

## Misc utils & types

### `utils/email.ts` — three-tier fallback

1. **Resend** (HTTPS API) — used if `RESEND_API_KEY` is set. `from` defaults to `VaultShare <onboarding@resend.dev>` (overridable via `RESEND_FROM`).
2. **Gmail/generic SMTP via nodemailer** — used if no Resend key but `SMTP_HOST` is set. Port from `SMTP_PORT` (default 587), `secure: true` only at port 465.
3. **Dev console fallback** — if neither is configured, logs `to`/`subject`/`text` to the console and returns — no network call.

Note `.env.example` only documents the SMTP path — `RESEND_API_KEY`/`RESEND_FROM`, despite being first-priority, aren't mentioned there. 8 exported helpers (`sendPasswordResetEmail`, `sendSigninOtpEmail`, `sendReauthOtpEmail`, `sendGroupAccessEmail`, `sendFileSharedEmail`, `sendVersionRequestEmail`, `sendVersionApprovedEmail`, `sendVersionRejectedEmail`) are thin wrappers around one internal `send()`.

### `utils/uuid.ts` — a second, redundant UUID generator

Wraps Node's built-in `crypto.randomUUID()` behind a `v4()` name (not the `uuid` npm package). Only 4 files use it: `auth.service.ts`, `collaboration.service.ts`, `chat.service.ts`, `group.service.ts`. Everything else in `src/` imports the `uuid` package's `v4()` directly — two functionally-equivalent, parallel ID generators coexist for no clear reason.

### `types/index.ts`

Auth/session request & payload shapes: `UserPayload {id, email, name, twoFactorEnabled?}` (decoded access token), `TempTokenPayload {id, requires2fa?, requiresEmailOtp?}`, and request bodies (`SignupBody`, `SigninBody`, `RefreshBody`, `ForgotPasswordBody`, `ResetPasswordBody`, `Verify2FABody`, `Validate2FABody`, `VerifySigninOtpBody`).

### `types/audit.types.ts`

`AuditAction` (15-value union), `AuditLogEntry {id, fileId, userId, userName, userEmail, fileOwnerName, fileOwnerId, action, details?, metadata?, timestamp}` (denormalized for display), `AuditSummaryStats {totalEvents, byAction, uniqueUsers, lastActivityAt}`.

## Deployment & build config

### `Dockerfile`

Single-stage, `node:20-alpine`. `npm ci --only=production` (skips devDependencies including all `@types/*` and `typescript`), then copies `src/`, installs TypeScript **globally** just to run `tsc` in-image. `EXPOSE 5001`, `CMD ["node", "dist/server.js"]`. No `HEALTHCHECK`, no non-root `USER` directive.

### `ecosystem.config.js` (PM2)

`name: 'vaultshare-backend'`, `script: 'dist/server.js'`, `instances: 1` with no `exec_mode` (defaults to **fork mode**, not cluster — no multi-core utilization), `autorestart: true`, `max_memory_restart: '512M'`. Only an `env_production` block exists (`NODE_ENV: 'production'`) — started via `pm2 start ecosystem.config.js --env production`.

### `ec2-setup.sh` (Amazon Linux 2023 provisioning)

1. `yum update` → install Node 20 (NodeSource) → install `git` → `npm install -g pm2`.
2. Clone the repo to `/home/ec2-user`, `git checkout main`.
3. `npm install` (full install, devDependencies included — unlike the Docker image), `npm run build`.
4. Comment-only reminder that `.env` must be `scp`'d manually — not automated.
5. `pm2 start ecosystem.config.js --env production`, `pm2 save`, `pm2 startup systemd`.

Nothing in the repo configures nginx/ALB itself, consistent with a reverse proxy sitting in front terminating TLS and forwarding to PM2's port 5001.

### `jest.config.js`

`preset: "ts-jest"`, `testEnvironment: "node"`, `roots: ["<rootDir>/tests"]`, `testMatch: ["**/*.test.ts"]`, `setupFiles: ["<rootDir>/tests/setupEnv.ts"]`, `clearMocks`/`restoreMocks: true`, `collectCoverageFrom: ["src/**/*.ts", "!src/server.ts"]`. Run via `test` → `jest --runInBand` (serialized), `test:coverage` → adds `--coverage`.

### `tsconfig.json`

`target: ES2020`, `module: commonjs`, `outDir: ./dist`, `rootDir: ./src`, `strict: true`, `esModuleInterop`, `skipLibCheck`, `forceConsistentCasingInFileNames`, `resolveJsonModule`. `ts-node` block: `esm: false`, `experimentalSpecifierResolution: "node"` (affects `dev`/`migrate:s3` scripts).

### `.env.example` — full configuration surface

`PORT`, `NODE_ENV`, `MONGODB_URI`, `JWT_SECRET`, `REFRESH_SECRET`, `TEMP_SECRET`, `CORS_ORIGIN`, `SMTP_HOST`/`PORT`/`USER`/`PASS`, `AWS_REGION`, `AWS_S3_BUCKET` (comment: use a **private** bucket, separate from any public/static-hosting bucket), `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` (both commented out — default AWS credential chain/IAM role recommended), `MAX_FILE_SIZE_MB` (default 50), `AUDIT_VIEW_DEDUP_WINDOW_MS`, `ENABLE_VIRUS_SCAN` (requires `clamscan` CLI), `VIRUS_SCAN_STRICT` (fail closed). Missing: `RESEND_API_KEY`/`RESEND_FROM` (used in code, undocumented here).

### `scripts/migrate-files-to-s3.ts`

One-off, re-runnable migration (`npm run migrate:s3 [-- --delete-local]`): for every `File` lacking an `activeVersionId`, reads the legacy on-disk copy, uploads it to S3 as version 1, creates a `FileVersion` row, and activates it. Already-migrated or disk-missing files are skipped. Local files are kept unless `--delete-local` is passed. Logs migrated/skipped/failed counts.

## Test suite

An unusually thorough taxonomy — 8 categorized suites beyond standard unit tests, each covering the **auth** and **dataIntegrity** (file upload/download/version) domains.

### `tests/setupEnv.ts` — global setup

Registered as Jest's `setupFiles`. Only sets env vars defensively: `NODE_ENV="test"`, placeholder `JWT_SECRET`/`REFRESH_SECRET`/`TEMP_SECRET`, `MAX_FILE_SIZE_MB="50"`. **There is no real database connection** — no `mongodb-memory-server` dependency, no real `mongoose.connect`. Every test file instead `jest.mock()`s the relevant `db/*Store` module and drives hand-rolled mock implementations (often a local `Map` reset in `beforeEach`). HTTP-level suites drive the exported Express `app` in-process via `supertest`, never binding a real port.

### Unit tests (`tests/unit/`)

| File | Covers |
|---|---|
| `accessControl.test.ts` | `getFilePermission`/`requireFileAccess` role resolution (owner vs. share, edit/owner gating, not-found) |
| `auth.service.test.ts` | Full auth state machine: signup validation + stale-account cleanup, lockout after 5 failures, OTP lockout, refresh rotation + reuse detection, password reset, 2FA lifecycle + TOTP replay |
| `chatHandlers.test.ts` | Pure `validateContent`/`isNonEmptyString` helpers (length/empty checks only) |
| `collaboration.service.test.ts` | `validateSharedRole`/`parseExpirationDate` + `inviteCollaborator` guard clauses |
| `file.controller.test.ts` | HTTP behavior: `originalMimeType` validation, signed-URL vs. legacy-stream shapes, `X-Content-Hash` header, error→status mapping |
| `file.service.test.ts` | SHA-256 per upload, storage-quota rejection, signed URL (900s) vs. legacy streaming, sha256 propagation |
| `upload.test.ts` | Multer MIME allowlist, 50MB limit, magic-byte sniffing vs. declared MIME |
| `version.service.test.ts` | Policy engine (direct/request/denied), approve/reject (S3 move/delete + notify), `activateVersion` metadata sync, active-version delete guard |
| `versionAccessControl.test.ts` | Pure `getVersionUploadDecision(policy, role)` decision table |
| `virusScan.test.ts` | ClamAV middleware: disabled-by-default, missing-file guards, clean/virus/unavailable outcomes, temp-file cleanup |

### The 8 categorized suites — what distinguishes each (auth domain)

| Category | Approach |
|---|---|
| **compatibility** | `authenticate` middleware across token/algorithm/secret variations — HS256-only (rejects HS384/wrong secret), expiry enforcement, exact `Bearer ` prefix, non-cross-verifiable secrets, bcrypt cost-10 hash stability. No HTTP layer. |
| **e2e** | Full `supertest` requests through the real `app` (route→middleware→controller→service), DB/email mocked, rate limiters stubbed. Walks the full signup→OTP→refresh→me→logout→forgot-password journey. |
| **integration** | Calls `auth.service` functions directly (no HTTP) but lets real `bcrypt`/`jsonwebtoken`/`speakeasy` execute — validates service-to-crypto-library wiring, not the HTTP contract. |
| **interface** | Via `supertest`, asserts the exact response *contract*: precise body key sets, no `passwordHash`/`refreshToken` leakage on `/me`, `Content-Type`. |
| **performance** | Pure micro-benchmarks: bcrypt hash/compare timing (incl. a timing-attack sanity check), JWT sign/verify throughput, SHA-256/OTP generation speed. No HTTP/service calls. |
| **regression** | 8 explicitly named historical bugs (`BUG-FIX-1`…`8`): plaintext refresh-token storage, plaintext-vs-hash lookup, stolen-token revocation, OTP brute-force lockout, TOTP replay window, `emailVerified` gating, stale-account cleanup, lockout bypass. |
| **security** | Attack-vector testing: NoSQL injection (`$gt`/`$ne`/`$regex`), JWT attacks (`alg:none`, tampered payload, RS256 confusion), account enumeration (identical error for unknown-email vs. wrong-password), body-size limits, blanket 401 on unauthenticated protected routes. |
| **usability** | API-consumer experience: non-generic error messages, semantically correct status codes, success bodies carrying what the client needs next (`requiresOtp`+`tempToken`). |

The `dataIntegrity.*.test.ts` counterparts hold the same category distinctions for the upload/download/version domain — e.g. **regression** covers 4 named fixes (virusScan undefined-buffer crash, unvalidated `originalMimeType`, `role_gated` viewer bypass, missing sha256 on upload); **security** covers MIME spoofing, `Content-Disposition` filename injection, sha256 tamper detection, path traversal, and the 900s presigned-URL expiry contract.
