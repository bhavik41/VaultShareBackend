# Middleware & Security

## `middleware/auth.ts` — JWT authentication

**Export:** `authenticate(req, res, next)`. Requires `Authorization: Bearer <token>` (missing/malformed → 401). Verifies with `jwt.verify(token, JWT_SECRET, { algorithms: ["HS256"] })` — the algorithm list is **explicitly pinned** (code comment: *"constrain to HS256 to prevent alg:none and RS/ES key-confusion attacks"*). On success, attaches the decoded `UserPayload` (`{id, email, name, twoFactorEnabled?}`) to `req.user`. Any failure — missing signature, bad signature, expired `exp` — collapses into one generic `401 "Unauthorized: Invalid or expired token"`, avoiding an info leak about *why* it failed.

Token expiries (set in `auth.service.ts`, not here): access `15m`, refresh `7d` (with a `jti`), temp 2FA `5m` — each signed with its own env secret (`JWT_SECRET`/`REFRESH_SECRET`/`TEMP_SECRET`), all fail-fast-checked at startup.

No "optional auth" variant exists anywhere. The closest analog is a private, unexported `getBearerUser` helper inside `shareLink.ts` that mimics this logic but returns `null` on failure instead of responding 401 — and it **omits** the `algorithms: ["HS256"]` restriction (see below).

## `middleware/permissions.ts` — file-level RBAC

**Export:** `requirePermission(action: FileAccessAction = "view")`. Reads `userId` from `req.user?.id` (must run after `authenticate`) and `fileId` from `req.params.fileId ?? req.params.id`. 401 if no user, 400 if no file id. Delegates to `requireFileAccess` (`utils/accessControl.ts`); maps `"File not found."` → 404, anything else (`"Access denied."`) → 403. Stores the resolved `{file, role}` on `req.filePermission` for downstream handlers to reuse without a second lookup.

## `utils/accessControl.ts` — canonical RBAC source of truth

- **Roles**: `viewer(1) < editor(2) < owner(3)`. **Actions**: `view(1), edit(2), download(2), owner(3)` — edit and download share the same required rank, so an editor can do both but a viewer can do neither.
- **`getFilePermission(fileId, userId)`** — throws `"File not found."` if missing; returns `owner` if `file.userId === userId`; else checks a direct share (takes precedence); else takes the **highest-ranked** role across all groups the user belongs to that have access; returns `null` if nothing grants access.
- **`requireFileAccess(fileId, userId, action)`** — throws a uniform `"Access denied."` whether the caller has no access at all or simply too little for the action, deliberately avoiding a "you have *some* access" information leak.
- **`getVersionUploadDecision(policy, role)`** → `"direct"|"request"|"denied"` — owners always direct; `admin_only` denies everyone else; `role_gated` gives editor+ "request" and denies viewers; `open` gives viewer+ direct upload.

## `middleware/rateLimiter.ts` — request-rate limiting

Six `express-rate-limit` instances, all IP-keyed (respecting `trust proxy: 1` in `app.ts`), `standardHeaders: true`/`legacyHeaders: false`. **All six are only ever used by `routes/auth.ts`** — no other route file applies request-rate limiting:

| Limiter | Window | Max | Routes |
|---|---|---|---|
| `signinLimiter` | 15 min | 10 | `/signin`, `/signin/verify-otp` |
| `forgotPasswordLimiter` | 60 min | 5 | `/forgot-password`, `/reset-password` |
| `twoFaLimiter` | 15 min | 10 | `/2fa/setup`, `/2fa/verify`, `/2fa/validate`, `/2fa/disable` |
| `signupLimiter` | 60 min | 10 | `/signup` |
| `refreshLimiter` | 15 min | 30 | `/refresh` |
| `reauthLimiter` | 15 min | 10 | `/reauth/request-otp`, `/reauth/verify-otp` |

Upload/download/share-link routes have no time-windowed limiting from this module — see `uploadThrottle.ts` for the (different) mechanism that covers uploads.

## `middleware/shareLink.ts` — public share-link gate

- **`validateShareLink`** — calls `collaborationService.validateShareLinkToken(token)`, stores the result on `req.shareLinkValidation`. Maps `"not found"` → 404, `"expired"`/`"revoked"` → 410, else 400.
- **`requireShareLinkDownloadPermission`** — for password-protected links, requires an unlock token (`X-Unlock-Token` header or `?unlockToken=`), 401 if absent. Verifies with `jwt.verify(unlockToken, JWT_SECRET)` and checks `decoded.type === "share-unlock" && decoded.shareToken === shareLink.token`. The unlock token itself is only minted after a successful `bcrypt.compare` against the link's password hash, scoped to 30 minutes. Branches on `permissionMode`: `"download"` → open to anyone with a valid link; `"admin-download"` → requires a Bearer JWT whose `id` matches the file owner (403 otherwise); any other mode → 403.

**Flag**: both `jwt.verify` calls in this file **omit** the `algorithms: ["HS256"]` restriction that `middleware/auth.ts` applies — an inconsistency worth fixing, though practical impact is limited since `JWT_SECRET` is a symmetric secret (the classic algorithm-confusion attack targets asymmetric key pairs).

## `middleware/upload.ts` — Multer config

**Storage**: `multer.memoryStorage()` — buffered in memory only, never written to disk; the service layer pushes the buffer straight to S3.

**Size limit**: `MAX_FILE_SIZE_MB` env var, **default 50 MB**.

**MIME allowlist**: ~34 entries (PDF, Office formats, text/csv, images, video, audio, archives, `application/vaultshare-encrypted` sentinel for client-side ciphertext). Three formats are **deliberately excluded** per inline comments: `text/html` (executes in-browser), `image/svg+xml` (can embed JS), `application/octet-stream` (catch-all bypass).

**`validateMagicBytes`** (runs after `upload.single`) — checks the first 16 bytes against known signatures (PDF, JPEG, PNG, GIF, WEBP/WAV, ZIP/OOXML, GZIP, 7z, OLE2, MP4). Text mimes and the encrypted sentinel are exempted. **Gap**: allowlisted MIME types with no signature entry (e.g. `application/x-rar-compressed`, `application/x-tar`, Photoshop formats) pass through with **no content verification at all** — a permissive fallback despite being commented as "conservative." Mismatches → 400.

## `middleware/uploadThrottle.ts` — concurrency cap

Distinct mechanism from `rateLimiter.ts`: an in-memory `Map<userId, count>` caps **3 concurrent uploads per user** (429 if exceeded), incremented before `next()` and decremented on response `finish`/`close`. No-ops if `req.user` is unset. Being in-memory, it doesn't coordinate across multiple app instances. Since request-rate limiting isn't applied to upload routes at all, this concurrency cap is effectively the only volume control on `/upload` and `/versions` besides the file-size limit.

## `middleware/virusScan.ts` — real ClamAV integration

This genuinely shells out to a `clamscan` CLI (via promisified `child_process.exec`) — **not** a stub or heuristic reimplementation. It depends on ClamAV being installed with an up-to-date signature DB on the host.

**Gating**: entirely opt-in via `ENABLE_VIRUS_SCAN` env var (no-ops if not `"true"`, or if `req.file`/`buffer` is absent).

**Flow**: writes the buffer to a temp file, runs `clamscan --no-summary`, always cleans up the temp file in a `finally` block. Exit `0` → clean. Exit `1` → `422 "Malware detected."` Anything else (exit `2`, or `ENOENT` if `clamscan` isn't installed) is logged via `console.warn`, then:
- Default: **fail open** — the upload proceeds unscanned.
- `VIRUS_SCAN_STRICT=true`: **fail closed** — `503 "Virus scanner unavailable."`

Whether uploads are actually scanned in a given deployment is entirely a config question (`ENABLE_VIRUS_SCAN`/`VIRUS_SCAN_STRICT` + ClamAV actually being installed), not something guaranteed by code presence alone.

## `middleware/auditValidation.ts` — defined but unused

`validateAuditQuery` (bounds `limit`∈[1,100]/`offset`≥0, checks `action` against a 9-value allowlist) and `validateDateRangeQuery` (`from`/`to` required + parseable) are **not imported by any route** — confirmed by a repo-wide search. `routes/audit.ts` mounts only `authenticate`; the controller does its own (partial) inline validation instead — `getAuditHistoryByDateRange` checks `from`/`to`, but `getMyActivity`/`getAuditHistory` apply **no bounds checking at all** on `limit`/`offset` (raw `parseInt` straight to the DB layer). Separately, this middleware's `AUDIT_ACTIONS` list is stale against the 15-member enum in `models/AuditLog.ts` — missing all 6 `version_*` actions — so wiring it in as-is would also need that list updated first.

## `utils/auditLogger.ts` — audit write path

**`requestMetadata(req)`** → `{ipAddress, userAgent}`. `ipAddress` is the first comma-separated value of `X-Forwarded-For` if present, else `req.socket.remoteAddress`, else `"unknown"`.

**Flag**: this manually parses `X-Forwarded-For` and trusts the **first (client-controllable) entry**, rather than using Express's own trust-proxy-aware `req.ip` (which `app.set("trust proxy", 1)` would make correct). A client behind the one trusted proxy hop can prepend an arbitrary IP to the header, and that spoofed value — not the real client address — is what lands in the audit trail. Worth fixing given the audit log's presumed forensic purpose.

**`logAction`/`logViewAction`** are both fire-and-forget (`.catch(err => console.error(...))`, don't return the promise) — a failed write only logs to console, never blocks or surfaces to the caller. `logViewAction` routes through `createViewLogDeduped` (default 5000ms dedup window via `AUDIT_VIEW_DEDUP_WINDOW_MS`, in-memory map, not shared across instances).

**Inconsistent field capture**: `AuditLog`'s schema declares top-level `ipAddress`/`userAgent` fields, but `createAuditLog` never populates them directly — it only ever sets `metadata` (Mixed), so IP/UA actually live nested under `metadata.ipAddress`/`metadata.userAgent` for rows written via this path, and the dedicated schema fields stay `undefined`. Some call sites (e.g. `routes/starred.ts`'s star-action log) pass no metadata at all, so those rows capture no IP/UA whatsoever.

## `config/s3.ts`

`S3_BUCKET = process.env.AWS_S3_BUCKET ?? ""` — **silently empty** if unset (contrast with `auth.service.ts`'s fail-fast pattern for JWT secrets; a missing bucket name here would only surface later as a runtime S3 error, not an immediate boot failure). `region` defaults to `"us-east-1"`. No explicit credentials in code — relies on the AWS SDK v3 default provider chain (env vars or an EC2/ECS instance role).

## Summary of flagged gaps

1. `shareLink.ts`'s JWT verification doesn't pin `algorithms: ["HS256"]` like `auth.ts` does.
2. `validateMagicBytes` silently accepts allowlisted-but-unsignatured MIME types with zero content verification.
3. Virus scanning is real (ClamAV) but fully opt-in and fails open by default.
4. `auditValidation.ts`'s bounds-checking is dead code — audit query params are effectively unvalidated in production.
5. Audit-trail IP attribution trusts a client-spoofable `X-Forwarded-For` value instead of Express's trust-proxy-aware `req.ip`.
6. Audit log IP/UA capture is inconsistent — nested under `metadata` rather than the schema's dedicated fields, and sometimes omitted entirely.
7. No time-windowed rate limiting on file upload/download/share-link routes — only an in-memory, per-instance concurrency cap.
8. `AWS_S3_BUCKET` unset fails silently at boot rather than fast.
