# Services Layer

Business logic beneath the controllers. Nine files; each owns one domain and talks to `db/*Store.ts` modules (see [data-model.md](data-model.md)).

## `audit.service.ts`

Read/enrichment layer over the audit log store, plus the write helper every other service calls.

- **`logAction(fileId, userId, action, details?, metadata?)`** — fire-and-forget (errors only `console.error`'d), the hook every mutating action calls afterward.
- **`getFileAuditHistory(fileId, requestingUserId, filters?, pagination?)`** — **owner-only** (`requireFileAccess(..., "owner")` — not editors/viewers), enriches each log with the acting user's name/email (cached per-user-per-call to avoid redundant lookups).
- **`getUserActivityHistory(userId, filters?, pagination?)`** — a user's own cross-file feed, enriched with file name/mimeType.
- **`getUserStats(userId)`** — pulls up to 1000 recent logs, computes today's-event count and top action client-side.

## `auth.service.ts`

Owns the entire auth lifecycle — largest security-critical file. Exports `issueAccessToken`/`issueRefreshToken`/`issueTempToken` (15m/7d/5m expiries), `getMe`, `signup`, `signin`, `verifySigninOtp`, `refresh`, `logout`, `requestReauthOtp`/`verifyReauthOtp`, `forgotPassword`/`resetPassword`, `setup2fa`/`verify2fa`/`validate2fa`/`disable2fa`.

Key business rules:
- Fails fast at module load if `JWT_SECRET`/`REFRESH_SECRET`/`TEMP_SECRET` are missing.
- **Signup**: passwords <8 chars rejected; unverified accounts >10min old are deleted to unblock the real owner on re-signup; bcrypt cost 12; always requires email-OTP verification.
- **Signin**: account lockout after 5 failed attempts (15 min); successful match resets the counter; 2FA-enabled accounts get a `requires2fa` temp token, otherwise always an email OTP.
- **OTP**: bcrypt-hashed at rest, 5-attempt brute-force cap before invalidation.
- **Refresh rotation**: stored as a SHA-256 hash; a valid-signature-but-hash-mismatch token is treated as replay/theft and **revokes all sessions** for that user.
- **2FA**: TOTP via `speakeasy`, replay protection rejects reusing the same code within its 30s window; disabling 2FA revokes the refresh token too.
- **Password reset**: `forgotPassword` always returns the same response regardless of whether the email exists (anti-enumeration); reset invalidates the existing session.

Touchpoints: `db/inMemoryStore.ts` (user CRUD — see [data-model.md](data-model.md#dbinmemorystorets--actually-the-user-store-actually-mongodb) for the naming caveat), `utils/email.ts`, `bcryptjs`, `jsonwebtoken`, `speakeasy`, `qrcode`, Node `crypto`.

## `chat.service.ts`

Thin persistence wrapper for real-time chat, used by the Socket.IO layer.

- **`saveMessage(fileId, userId, userName, userEmail, content)`** — builds the message object (uuid + ISO timestamp) and persists it; the same object is what gets broadcast.
- **`getMessages(fileId, limit=50, before?)`** — fetches up to 100 messages (the store's own cap), optionally filters to before a timestamp, slices to `limit`. Deep history beyond the most recent 100 isn't reachable this way.
- **`clearRoom(fileId)`** — deletes all messages for a file. **Not called anywhere** — dead code, not wired into file deletion.

Touchpoints: `db/chatStore.ts` only. Full real-time trace in [realtime-chat.md](realtime-chat.md).

## `collaboration.service.ts`

Direct (non-group) sharing: invitations, accepted shares, and token-based share links.

Key business rules:
- Direct-share roles restricted to `editor`/`viewer`; share-link `permissionMode` restricted to `viewer`/`editor`/`download`/`admin-download`.
- Only the file **owner** (strict `file.userId === userId` check) can invite, share, list invitations, or manage collaborators/links.
- Duplicate-prevention: no self-invite, no inviting someone who already has access, no duplicate pending invitations.
- Invitations require the invitee to already have a registered account.
- `respondToInvitation` is race-safe — re-checks status is still `pending`, reuses an existing share record if one raced into existence.
- Share links: token via `crypto.randomBytes(32)`; optional bcrypt-hashed password; default 24h expiry; unlock issues a 30-min-scoped JWT (`type: "share-unlock"`); validation checks both revocation and expiry and strips `passwordHash` before returning to the client.
- Batch-resolves file/user lookups (`getFilesByIds`/`findUsersByIds`) to avoid N+1 queries.
- Every mutating action audit-logs and fires an async, error-swallowed notification email.

Touchpoints: `db/collaborationStore.ts`, `db/fileStore.ts`, `db/inMemoryStore.ts`, `services/audit.service.ts`, `utils/email.ts`, `bcryptjs`, `jsonwebtoken`, Node `crypto`.

## `dashboard.service.ts`

Pure aggregation/read-model layer — no mutations. Composes "my documents" (owned + shared), search/filter/sort, storage stats, and a recent-activity feed.

Filtering (query match on name/owner name/owner email; type via mimeType/extension; ownership all/owned/shared) and sorting (name/date/size/mimeType) are computed **in-process** after fetching everything — no query-level pushdown. `getRecentActivity` merges three synthesized activity types (uploaded, shared-with-me, shared-by-me) and returns the 10 most recent. Group-shared files are **not** included here (that's a separate surface via `group.service.ts`).

Touchpoints: `db/fileStore.ts`, `db/collaborationStore.ts`, `db/inMemoryStore.ts`.

## `documentAI.service.ts` — Document Q&A

A **from-scratch lexical RAG pipeline** — no vector store, no embeddings API. Retrieval is a self-implemented BM25 keyword-ranking algorithm. Single export: `askQuestion(fileId, question)`.

Pipeline:
1. **Extraction** — pulls the active version's bytes from S3. PDF → `pdf-parse`; `.docx`/`.doc` → `mammoth`; `text/*`/JSON → raw UTF-8. Other types throw "Unsupported file type for Q&A."
2. **Chunking** — normalizes whitespace, splits into fixed **500-word windows with 50-word overlap** (word-count based, not sentence/token-aware).
3. **Indexing** — deletes prior chunks for the file, bulk-inserts new ones into `DocumentChunkModel`. Throws if extraction produced zero chunks (e.g. scanned/image-only PDFs).
4. **Lazy re-indexing** — `askQuestion` checks whether the indexed `indexedS3Key` still matches the file's *current* active version; re-indexes on the fly if the file changed or was never indexed. Indexing is on-demand, not upload-triggered.
5. **Retrieval** — tokenizes (lowercase alphanumerics, drops ≤2-char tokens and ~90 stop words), scores every chunk via manual Okapi BM25 (`k1=1.5, b=0.75`), takes the top 6, then **re-sorts back into document order** before sending to the LLM. If every chunk scores 0 (no keyword overlap), falls back to an evenly-spaced sample across the document instead of returning nothing.
6. **Generation** — prompts **NVIDIA's hosted inference API** (`https://integrate.api.nvidia.com/v1`, model `meta/llama-3.1-8b-instruct`) via the `openai` npm SDK used purely as an OpenAI-compatible HTTP client — the model provider is NVIDIA/Llama, not OpenAI, and neither Anthropic nor Gemini SDKs are touched anywhere in this file.
7. **Demo mode** — if `NVIDIA_API_KEY` is unset, skips indexing/retrieval and cycles through 4 canned responses, returning `chunksUsed: 0`.

No permission check happens inside this service itself — access control is the route's job (`requirePermission("view")`). Touchpoints: `models/File.ts`, `models/DocumentChunk.ts`, `db/fileVersionStore.ts`, `services/s3.service.ts`, `pdf-parse`, `mammoth`, `openai` SDK.

## `file.service.ts`

Core file lifecycle — upload, list, download, delete. Preview/format-conversion (PPTX→PDF) is **not** here; it lives directly in `routes/previewPdf.ts`.

- **`uploadFile(userId, multerFile, options?)`** — enforces quotas (1000 files, 1GB per user), computes SHA-256, uploads to S3, creates the file row **and** a version-1 row, marks it active — every file is versioned from creation. `options.isEncrypted`/`originalMimeType` flag client-side-encrypted uploads, preserving the true MIME type separately from the opaque-ciphertext content-type given to S3.
- **`downloadFile(fileId, requestingUserId)`** — requires `download` access; returns a **15-min presigned S3 URL** if an active version exists, else falls back to streaming a legacy on-disk file (reflecting the pre-S3 migration — see `scripts/migrate-files-to-s3.ts` in [testing-deployment.md](testing-deployment.md)).
- **`resolveContent`/`streamFileDownload`/`streamFileDownloadForShareLink`** — server-proxied streaming for inline preview; the share-link variant skips the owner/collaborator check (the share-link's own token validation covers that upstream).
- **`deleteFile(fileId, requestingUserId)`** — strict owner-only; deletes every version's S3 object in parallel (errors swallowed per-object), then version rows, then the file record — no rollback if a partial failure occurs.
- **`getFileDetails`** — requires `view` access, returns file + role.
- **`setAdminOnlyChat`** — strict owner-only toggle.

The server never encrypts/decrypts bytes itself — "encryption-aware" here means threading an `isEncrypted` flag and preserving the original MIME type; actual crypto is a client-side concern (see the frontend's [security.md](../../VaultShareFrontened/docs/security.md)).

Touchpoints: `services/s3.service.ts`, `db/fileStore.ts`, `db/fileVersionStore.ts`, `utils/accessControl.ts`.

## `group.service.ts`

Group-based collaboration — CRUD, membership (viewer/editor/admin), and sharing files with a whole group at once.

- Group roles ranked `viewer < editor < admin`; the group **owner** always has implicit full access without a membership row.
- `requireGroupOwnerOrAdmin` gates edits, member add/role-change.
- Guardrails: can't add yourself or the owner as a "member," can't change/remove the owner.
- `deleteGroupById` (owner-only) removes all members + file shares before deleting the group — no rollback.
- `shareFileWithGroup` is restricted to the **file owner** (not group owner); fans out notification emails to every group member.
- `getFilesSharedWithUserViaGroups` computes an effective per-file role: only group admin/editor members can inherit an `editor` file-share role, plain viewers always get `viewer` regardless of the underlying share.
- **Does not call `audit.service.ts`** — unlike collaboration/version services, group actions are not audit-logged.

Touchpoints: `db/groupStore.ts`, `db/fileStore.ts`, `db/inMemoryStore.ts`, `utils/email.ts`.

## `s3.service.ts`

Thin, exclusive wrapper around AWS S3 — the sole storage backend (no GCS usage despite `@google-cloud/storage` being a listed dependency).

- **`buildVersionKey(userId, fileId, versionNumber, originalName)`** — `uploads/{userId}/{fileId}/v{n}_{uuid}{ext}`.
- **`buildStagingKey(fileId, originalName)`** — `staging/{fileId}/pending_{uuid}{ext}`, for version requests awaiting approval.
- **`putObject`/`getObjectStream`/`deleteObject`** — standard S3 operations.
- **`moveObject(sourceKey, destKey)`** — copy then delete; used when an approved version request is promoted from staging to permanent.
- **`getPresignedDownloadUrl(key, expiresInSeconds=300)`** — kept for redirect-style downloads, though the default download path uses its own 15-min presign inline rather than this helper's 5-min default.

Touchpoints: `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `config/s3.ts` (region/bucket from env, credentials via the default AWS provider chain / IAM role).

## `version.service.ts`

Versioning + the admin-approval workflow. Policy-driven state machine using `getVersionUploadDecision(policy, role)` (`utils/accessControl.ts`) → `"direct" | "request" | "denied"`.

- **`uploadVersionDirect`** — requires decision `"direct"`; re-checks the **owner's** total storage quota (not the uploader's); SHA-256, S3 upload, version row, audit-logs `version_upload`.
- **`requestVersionUpload`** — requires decision `"request"`; stores to a **staging** S3 key, creates a `VersionRequest`, notifies + emails the owner.
- **`approveVersionRequest`** — owner-only; moves the staged object to its final key, creates the version row, marks approved, notifies + emails the requester.
- **`rejectVersionRequest`** — owner-only; deletes the staged object, marks rejected, notifies + emails requester.
- **`activateVersion`** — owner-only; switches the active version and syncs the parent file's `size`/`mimeType`/`isEncrypted` to match.
- **`deleteVersion`** — owner-only; explicitly blocks deleting the currently-active version.
- **`downloadVersion`** — requires `download` access (any qualifying role); streams a specific historical version, audit-logs.
- **`updateVersionPolicy`** — owner-only; validates against the fixed policy enum.

Touchpoints: `services/s3.service.ts`, `services/audit.service.ts`, `db/fileStore.ts`, `db/fileVersionStore.ts`, `db/versionRequestStore.ts`, `db/notificationStore.ts`, `utils/accessControl.ts`, `utils/email.ts`.

## External-integration landscape

Of the AI/cloud SDKs in `package.json`, only three are actually wired into any code path:

- **AWS S3** — the only object-storage backend, entirely encapsulated in `s3.service.ts`. Legacy on-disk storage still has fallback *read* paths (pre-migration files) but nothing new is ever written to disk.
- **`@google-cloud/storage`** — unused, dead dependency.
- **`@anthropic-ai/sdk`** and **`@google/generative-ai`** — both unused, dead dependencies.
- **`openai` SDK** — used once, in `documentAI.service.ts`, pointed at NVIDIA's NIM endpoint running Llama 3.1 8B Instruct — an OpenAI-*shaped* client, not OpenAI's own infrastructure.
- **`pdf-parse`**/**`mammoth`** — text extraction feeding Q&A only, not previews.
- **`libreoffice-convert`** — PPTX→PDF preview conversion, used only in `routes/previewPdf.ts`, unrelated to the Q&A pipeline.

In short: real integrations = **AWS S3** (storage) + **NVIDIA-hosted Llama 3.1** (Q&A) + **LibreOffice headless** (PPTX preview). GCS, Anthropic, and Gemini are present in `package.json` but disconnected from any code path.
