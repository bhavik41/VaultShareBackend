# API Reference

Base path for everything below is the server root (e.g. `http://localhost:5001`). All routes are mounted in [`src/app.ts`](../src/app.ts). Error responses generally follow: 400 bad request/validation, 401 unauthenticated, 403 access denied, 404 not found, 409 conflict, 410 gone (expired/revoked), 422 unprocessable, 429 rate-limited, 500 unhandled.

**Permission model** (`utils/accessControl.ts`, enforced by `requirePermission` in [security-middleware.md](security-middleware.md)): roles ranked `viewer(1) < editor(2) < owner(3)`; actions ranked `view(1), edit(2), download(2), owner(3)`. A caller passes if their role rank ≥ the action's rank — so `requirePermission("download")` admits editor *or* owner, and `requirePermission("owner")` admits only the file's actual owner.

## Auth — `/api/auth` (`routes/auth.ts` ↔ `auth.controller.ts`)

| Method | Path | Rate limit | Auth | Description |
|---|---|---|---|---|
| POST | `/signup` | 10/hr/IP | Public | Creates a pending user, sends email OTP. 201 `{requiresOtp, tempToken}`; 409 if email exists. |
| POST | `/signin` | 10/15min/IP | Public | Validates password. Returns `{requires2fa, tempToken}` or `{requiresOtp, tempToken}`. 401 on bad creds; locks account 15min after 5 failures. |
| POST | `/signin/verify-otp` | 10/15min/IP | Public | `{tempToken, otp}` → `{token, refreshToken, user}`. |
| POST | `/refresh` | 30/15min/IP | Public | `{refreshToken}` → rotated `{token, refreshToken}`. Reuse of an already-rotated token revokes all sessions. |
| POST | `/logout` | — | Bearer | Invalidates the stored refresh token. |
| GET | `/me` | — | Bearer | Current user profile; 404 if not found. |
| POST | `/reauth/request-otp` | 10/15min/IP | Bearer | Sends OTP for idle-session step-up re-auth. |
| POST | `/reauth/verify-otp` | 10/15min/IP | Bearer | `{otp}` unlocks the idle-gated UI. |
| POST | `/forgot-password` | 5/hr/IP | Public | Sends reset OTP. Always 200 regardless of whether the email exists (anti-enumeration). |
| POST | `/reset-password` | 5/hr/IP | Public | `{email, otp, newPassword}` → resets password, invalidates existing session. |
| POST | `/2fa/setup` | 10/15min/IP | Bearer | Generates TOTP secret + QR provisioning data. |
| POST | `/2fa/verify` | 10/15min/IP | Bearer | `{token}` confirms setup, enables 2FA. |
| POST | `/2fa/validate` | 10/15min/IP | Public | `{tempToken, token}` completes signin when 2FA is required. |
| DELETE | `/2fa/disable` | 10/15min/IP | Bearer | `{token}` disables 2FA; revokes refresh token as a safety measure. |

## Files — `/api/files` (`routes/files.ts` ↔ `file.controller.ts`, `authenticate` applied to the whole router)

| Method | Path | Middleware | Description |
|---|---|---|---|
| POST | `/upload` | `uploadThrottle`, `upload.single("file")`, `validateMagicBytes`, `virusScan` | Uploads to S3. Body `encrypted` ("true"/"false"), optional `originalMimeType`. Logs `upload`. |
| GET | `/` | — | Lists files owned by/visible to the caller. |
| GET | `/:fileId/download` | `requirePermission("download")` | Returns a 15-min presigned S3 URL (`{url, sha256}`) or streams with `Content-Disposition: attachment` for legacy pre-S3 files. Logs `download`. |
| GET | `/:fileId/preview` | `requirePermission("view")` | Streams inline (`Content-Disposition: inline`) for in-browser preview. Logs a view. |
| GET | `/:fileId/view` | `requirePermission("view")` | File metadata + caller's role. Logs a view. |
| DELETE | `/:fileId` | `requirePermission("owner")` | Deletes the file and all its versions from S3 + DB. Logs `delete`. |
| PATCH | `/:fileId/version-policy` | `requirePermission("owner")` | Updates the file's version-approval policy. |
| PATCH | `/:fileId/admin-only-chat` | `requirePermission("owner")` | Body `{adminOnlyChat: boolean}`. |

Filenames are sanitized (strips `\r\n"/\\`) before being placed in `Content-Disposition` to prevent header injection.

## Collaboration — `/api/collaboration` (`routes/collaboration.ts` ↔ `collaboration.controller.ts`)

**Public routes** (share-link consumption needs no VaultShare account), before `router.use(authenticate)`:

| Method | Path | Middleware | Description |
|---|---|---|---|
| GET | `/share-links/:token/download` | `validateShareLinkMiddleware`, `requireShareLinkDownloadPermission` | Streams the shared file. `download` mode: open to anyone with the link. `admin-download` mode: requires a Bearer JWT matching the file owner. Password-protected links require an `X-Unlock-Token`. |
| GET | `/share-links/:token` | `validateShareLinkMiddleware` | Share-link metadata/validity, no download. |
| POST | `/share-links/:token/unlock` | — | `{password}` → short-lived `unlockToken` JWT (401 wrong password, 404 not found). |

**Authenticated routes** — two overlapping generations of the same functionality coexist (the second set was added by a later feature branch without removing the first):

| Method | Path | Description |
|---|---|---|
| POST | `/files/:fileId/invitations` | Invite by email + role (409 if already invited/shared). |
| GET | `/invitations` | Paginated invitations sent to me. |
| GET | `/files/:fileId/invitations` | Invitations outstanding on a file. |
| PATCH | `/invitations/:invitationId/respond` | `{status}` accept/reject. |
| POST | `/files/:fileId/share` | Direct share, `{collaboratorEmail, role}`. |
| GET | `/files/:fileId/shared-users` | Paginated collaborators. |
| PATCH | `/files/:fileId/collaborators/:userId` | `{role}`. |
| DELETE | `/files/:fileId/collaborators/:userId` | Removes a collaborator. |
| GET | `/shared-with-me` | Paginated. |
| POST | `/files/:fileId/share-links` | `{permissionMode, expiresAt, password}`. |
| GET | `/files/:fileId/share-links` | Lists links for a file. |
| DELETE | `/share-links/:token` | Revokes a link. |
| GET | `/pending` | *(legacy alias)* same data as `GET /invitations`. |
| POST | `/accept/:invitationId` | *(legacy alias)* alternate accept flow. |
| POST | `/reject/:invitationId` | *(legacy alias)* alternate reject flow. |
| PATCH | `/:fileId/role/:userId` | *(legacy alias)* alternate role-change endpoint. |
| DELETE | `/:fileId/revoke/:userId` | *(legacy alias)* alternate revoke endpoint. |

Errors via a shared `getErrorStatus()`: 403 access denied, 404 not found, 409 "already"/"pending invitation"/"already has access", 410 expired/revoked, else 400.

## Dashboard — `/api/dashboard` (`routes/dashboard.ts` ↔ `dashboard.controller.ts`, all `authenticate`)

| Method | Path | Description |
|---|---|---|
| GET | `/` | Combined overview snapshot. |
| GET | `/documents` | Filtered/sorted document list. |
| GET | `/stats` | Aggregate counts. |
| GET | `/activity` | Recent-activity feed. |

Shared query params: `q` (search), `type` (file type), `ownership` (`owned`\|`shared`\|`all`), `sort` (`name_asc/desc`, `date_newest/oldest`, `size_asc/desc`, `type_asc`) — invalid values fall back to defaults rather than erroring.

## Audit & Activity

`routes/audit.ts` exports **two** routers; `routes/activity.ts` is a near-duplicate of one of them (see [Known issues](architecture.md#known-issues--inconsistencies)):

| Method | Full path | Description |
|---|---|---|
| GET | `/api/files/:fileId/audit` | File's full audit trail, **owner-only**. Query `action`, `limit`, `offset` (unvalidated — see below). |
| GET | `/api/files/:fileId/audit/range` | Query `from`/`to` (required ISO dates, 400 if missing/invalid) + `limit`/`offset`. |
| GET | `/api/audit/my-activity` | Caller's own cross-file activity. Query `actions` (comma-separated), `limit`, `offset`. |
| GET | `/api/audit/stats` | Aggregate per-action counts for the caller's files. |
| GET | `/api/activity/my-activity` | Identical handler to `/api/audit/my-activity` — legacy duplicate route. |

`middleware/auditValidation.ts` defines bounds-checking validators for these routes but they are **not wired in** — `limit`/`offset` go through un-validated in practice.

## Starred — `/api/starred` (`routes/starred.ts`, inline handlers, no dedicated controller)

| Method | Path | Description |
|---|---|---|
| GET | `/` | `{fileIds: string[]}` starred by the caller. |
| POST | `/:fileId` | Idempotent star (upsert); fire-and-forget audit log. |
| DELETE | `/:fileId` | Un-star. |
| GET | `/audit` | Last 50 `star`-action audit logs for the caller. |

All errors here are caught generically as 500 — no distinct 403/404 handling.

## Chat — `/api/chat` (`routes/chat.ts` ↔ `chat.controller.ts`, all `authenticate`)

| Method | Path | Description |
|---|---|---|
| GET | `/:fileId/messages` | Query `limit` (default 50, capped 200), `before` (ISO cursor). Paginated history. |
| GET | `/:fileId/online` | `{users, count}` currently connected to the file's Socket.IO room. |

Neither route runs `requirePermission` — any authenticated user who knows a `fileId` can read chat history/presence via REST regardless of file access. Full real-time contract in [realtime-chat.md](realtime-chat.md).

## Groups — `/api/groups` (`routes/groups.ts` ↔ `group.controller.ts`, all `authenticate`)

| Method | Path | Description |
|---|---|---|
| POST | `/` | `{name, description?, defaultRole?}` (defaults `viewer`). |
| GET | `/` | Groups the caller owns/belongs to. |
| GET | `/files-shared-with-me` | Files shared via any group (ordered before `/:groupId` to avoid shadowing). |
| GET | `/:groupId` | Group details. |
| PUT | `/:groupId` | `{name, description, defaultRole}`. |
| DELETE | `/:groupId` | Deletes group + all members/shares. |
| POST | `/:groupId/members` | `{email, role}`. |
| GET | `/:groupId/members` | List members. |
| PATCH | `/:groupId/members/:userId` | `{role}`. |
| DELETE | `/:groupId/members/:userId` | Removes member. |
| POST | `/:groupId/files` | `{fileId, role}` — shares with the whole group, emails members. |
| GET | `/:groupId/files` | Files shared with this group. |
| PATCH | `/:groupId/files/:fileId` | `{role}`. |
| DELETE | `/:groupId/files/:fileId` | Unshares file from group. |

Errors: 403 access denied, 404 not found, 409 "already", else 400. Note: group actions are **not** audit-logged (unlike collaboration/version actions).

## Versions — `/api/files/:fileId/versions` + `/api/version-requests` (`routes/versions.ts` ↔ `version.controller.ts`)

Permission checks happen **inside `version.service.ts`** per call (not as route middleware):

| Method | Path | Middleware | Description |
|---|---|---|---|
| GET | `/api/files/:fileId/versions` | `authenticate` | Lists versions (`s3Key` stripped from response). |
| POST | `/api/files/:fileId/versions` | + upload stack | Direct new-version upload (owner, or others per policy). Body `changeNote`, `encrypted`. |
| POST | `/api/files/:fileId/versions/request` | + upload stack | Submits for approval instead of applying directly. |
| GET | `/api/files/:fileId/versions/requests` | `authenticate` | Pending requests for this file (owner view). |
| GET | `/api/files/:fileId/versions/my-request` | `authenticate` | Caller's own pending request. |
| GET | `/api/files/:fileId/versions/my-rejected` | `authenticate` | Caller's rejected requests. |
| POST | `/api/files/:fileId/versions/requests/:requestId/approve` | `authenticate` | Owner approves. |
| POST | `/api/files/:fileId/versions/requests/:requestId/reject` | `authenticate` | Owner rejects. |
| PATCH | `/api/files/:fileId/versions/:versionId/activate` | `authenticate` | Marks a version active; syncs file's summary fields. |
| GET | `/api/files/:fileId/versions/:versionId/download` | `authenticate` | Streams with sanitized `v{n}_{name}` filename. |
| DELETE | `/api/files/:fileId/versions/:versionId` | `authenticate` | Refuses to delete the currently-active version. |
| GET | `/api/version-requests` | `authenticate` | Cross-file admin queue: every pending request on any file the caller owns. |

Version policy engine (`getVersionUploadDecision`, in `utils/accessControl.ts`): owner always direct; `admin_only` denies everyone else; `role_gated` → editor+ can request (needs approval), viewers denied; `open` → viewer+ can upload directly.

## Notifications — `/api/notifications` (`routes/notifications.ts` ↔ `notification.controller.ts`, all `authenticate`)

| Method | Path | Description |
|---|---|---|
| GET | `/` | All notifications for the caller. |
| PATCH | `/:notificationId/read` | Marks read; 404 if not found/not owned. |

## Document Q&A — `/api/files/:fileId/ask` (`routes/documentAI.ts`, inline handler)

| Method | Path | Middleware | Description |
|---|---|---|---|
| POST | `/` | `authenticate`, `requirePermission("view")` | Body `{question}` (≤2000 chars). Returns `{answer, chunksUsed, totalChunks}`. Errors: "not found"→404, "not configured"→503, "Unsupported file type"→422, else 500. |

Full retrieval pipeline in [services.md](services.md#documentaiservicets--document-qa).

## PPTX Preview — `/api/files/:fileId/preview-pdf` (`routes/previewPdf.ts`, inline handler)

| Method | Path | Middleware | Description |
|---|---|---|---|
| GET | `/` | `authenticate`, `requirePermission("view")` | PPTX/PPT only (422 otherwise). Converts the active version to PDF via headless LibreOffice, returns `application/pdf` with `Cache-Control: private, max-age=300`. 404 if no active version. |

## Test-only routes — `/api/test` (`routes/test.ts`, only when `ENABLE_E2E_ROUTES=true`)

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/session` | None (by design) | `{email, name?, password?}` — finds-or-creates a user and mints real tokens, bypassing signup/OTP/2FA, purely so Playwright e2e tests can get a valid session. Logged loudly at boot when enabled. |
