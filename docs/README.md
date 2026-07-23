# VaultShare Backend — Documentation

Detailed developer documentation for the VaultShare backend (Express + TypeScript + MongoDB + S3). Start with [architecture.md](architecture.md) for the high-level map, then drill into whichever subsystem you're touching.

| Doc | Covers |
|---|---|
| [architecture.md](architecture.md) | Tech stack, project structure, request flow, layering conventions, and a running list of known issues/inconsistencies found in the codebase |
| [api-reference.md](api-reference.md) | Every route across all 14 route files: method, path, middleware, auth/permission requirements, description |
| [services.md](services.md) | All 9 services — business logic, external integrations (S3, NVIDIA/Llama, LibreOffice), and what's actually wired up vs. dead dependencies |
| [data-model.md](data-model.md) | All 11 Mongoose schemas and their store-layer wrappers, plus the `inMemoryStore.ts` naming/documentation caveat |
| [security-middleware.md](security-middleware.md) | Auth, RBAC, rate limiting, upload validation, virus scanning, audit logging — including several flagged gaps |
| [realtime-chat.md](realtime-chat.md) | Socket.IO server: event contract, presence/typing, admin-only-chat trace, matched against the frontend's socket client |
| [testing-deployment.md](testing-deployment.md) | Utils, Docker/PM2/EC2 deployment config, and the 8-category test suite taxonomy |

The existing [README.md](../README.md) and [SECURITY_IMPLEMENTATION.md](../SECURITY_IMPLEMENTATION.md) at the repo root remain useful for a quick-start and the security narrative, but both predate several features (collaboration, groups, versioning, chat, audit logs, document Q&A) and contain a couple of stale claims corrected in the docs above — most notably the description of `src/db/inMemoryStore.ts` as an in-memory store (see [data-model.md](data-model.md#dbinmemorystorets--actually-the-user-store-actually-mongodb)).

## Quick start

```bash
npm install
cp .env.example .env      # fill in MONGODB_URI, JWT secrets, AWS creds, etc.
npm run dev                 # ts-node + nodemon, http://localhost:5001
```

The frontend ([VaultShareFrontened](../../VaultShareFrontened)) expects this running on the port set by `VITE_API_URL`.

## At a glance

- **14 route files / 8 controllers / 9 services / 11 Mongoose models / 10 store modules / 8 middleware files.**
- Layered architecture: routes → controllers → services → db stores → models, with a few documented exceptions where controllers are skipped for inline handlers.
- Auth: JWT access/refresh/temp tokens, bcrypt password + OTP hashing, TOTP 2FA with replay protection, account lockout, refresh-token-reuse detection.
- Files: S3-backed storage with versioning, an owner-approval workflow for gated uploads, magic-byte + optional ClamAV validation, and a hand-rolled BM25 document Q&A pipeline (NVIDIA-hosted Llama 3.1).
- Real-time: one Socket.IO room per file for chat, presence, typing, and an owner-only "admin-only chat" toggle.
- Testing: Jest + Supertest, with an unusually thorough 8-category taxonomy (compatibility/e2e/integration/interface/performance/regression/security/usability) layered on top of standard unit tests.
