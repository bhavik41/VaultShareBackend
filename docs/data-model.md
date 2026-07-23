# Data Model: MongoDB Models & Store Layer

## Conventions

All 11 models share three conventions: every schema uses `_id: { type: String }` (app-generated UUIDv4s, not Mongo `ObjectId`s), **none** declare a Mongoose `ref`/`populate` relationship, and none define instance/static methods or hooks. Cross-model relationships are all soft foreign keys — plain `String` fields (`fileId`, `userId`, `ownerId`, `groupId`, etc.) resolved manually in the store layer via `find`/`$in` queries.

Every store file (except `mongoose.ts`, the connection bootstrap) follows the **repository pattern**: a thin async-function wrapper around one or more Mongoose models, with a private mapper converting lean Mongoose docs to plain DTOs. IDs are generated with `uuidv4()` in the store layer, not by Mongo.

## `db/mongoose.ts` — connection

`connectDB()` reads `process.env.MONGODB_URI`, throwing synchronously if unset (no default/fallback URI). Connects with `serverSelectionTimeoutMS: 5000, connectTimeoutMS: 10000, socketTimeoutMS: 10000` — **no retry/backoff logic and no `connection.on('error', …)` listeners**; a failed connect simply rejects and propagates to whatever calls `connectDB()` at startup (see [`server.ts`](../src/server.ts)).

## Models

### AuditLog
| Field | Type | Notes |
|---|---|---|
| fileId, userId | String | required, indexed |
| action | String enum | 15 values (upload, download, view, share, permission_change, delete, revoke_access, star, invitation_accepted, version_upload/request/approved/rejected/activated/deleted) |
| details | String | optional |
| ipAddress, userAgent | String | optional — **not actually populated** by `createAuditLog`, see [security-middleware.md](security-middleware.md) |
| metadata | Mixed | optional — IP/UA actually land here in practice |
| timestamp | Date | default now, indexed, **TTL `expires: "90d"`** (auto-purges after 90 days) |

Compound indexes: `{fileId,timestamp:-1}`, `{userId,timestamp:-1}`, `{userId,action,timestamp:-1}`.

### ChatMessage
`fileId` (req, indexed), `userId`, `userName`, `userEmail` (default `''`), `content`, `timestamp` (default now). Compound index `{fileId:1, timestamp:1}`.

### Collaboration (`models/Collaboration.ts` exports 3 models)
- **Invitation**: `fileId` (indexed), `inviterId`, `inviteeId` (indexed), `inviteeEmail`, `role` enum `editor|viewer`, `status` enum `pending|accepted|rejected` (default pending), `createdAt`, `respondedAt`. Index `{fileId,inviteeId}`.
- **FileShare**: `fileId`, `ownerId`, `userId`, `role` enum `editor|viewer`, timestamps. Indexes: `{fileId,userId}` **unique**, `{userId}`.
- **ShareLink**: `fileId` (indexed), `ownerId`, `token` (**unique**, indexed), `permissionMode` enum `viewer|editor|download|admin-download`, `expiresAt`, `revokedAt` (default null), `createdAt`, `passwordHash` (default null).

### DocumentChunk
`fileId` (indexed), `indexedS3Key`, `chunkIndex` (Number), `text`, `wordCount` (Number), `createdAt`. Index `{fileId:1, chunkIndex:1}`. Backing store for the BM25 Q&A pipeline ([services.md](services.md#documentaiservicets--document-qa)).

### File
| Field | Type | Notes |
|---|---|---|
| userId | String | required, indexed — owner |
| originalName, mimeType, size | — | required |
| diskPath | String | optional, default `''` — **legacy** pre-S3 field, empty for new files |
| publicUrl | String | required |
| adminOnlyChat | Boolean | default false |
| isEncrypted | Boolean | default false |
| versionPolicy | enum `admin_only\|role_gated\|open` | default `admin_only` |
| activeVersionId | String\|null | default null — soft pointer into FileVersion |

### FileVersion
`fileId` (indexed), `versionNumber` (Number), `uploadedBy`, `s3Key`, `originalName`, `size`, `mimeType`, `changeNote` (optional), `isActive` (default false), `isEncrypted` (default false), `sha256` (optional), `createdAt`. Indexes: `{fileId,versionNumber}` **unique**, `{fileId,isActive}`.

### Group (`models/Group.ts` exports 3 models)
- **Group**: `name`, `description` (optional), `ownerId` (indexed), `defaultRole` enum `viewer|editor` (default viewer), timestamps.
- **GroupMember**: `groupId` (indexed), `userId` (indexed), `role` enum `viewer|editor|admin`, `joinedAt`. Index `{groupId,userId}` **unique**.
- **GroupFileShare**: `groupId` (indexed), `fileId` (indexed), `ownerId`, `role` enum `viewer|editor`, timestamps. Index `{groupId,fileId}` **unique**.

### Notification
`userId` (indexed — recipient), `type` enum `version_request|version_approved|version_rejected`, `fileId`, `message`, `read` (default false), `createdAt` (indexed). Compound index `{userId:1, read:1, createdAt:-1}` for unread-feed queries.

### Starred
`userId`, `fileId`, `createdAt`. Indexes: `{userId,fileId}` **unique** (no double-star), `{userId}`.

### User
| Field | Type | Notes |
|---|---|---|
| name, passwordHash | String | required |
| email | String | required, **unique**, lowercase, trim |
| refreshToken | String\|null | default null |
| twoFactorSecret, twoFactorEnabled | — | default null / false |
| lastUsedTotpCode, lastUsedTotpAt | — | TOTP replay-prevention pair |
| resetOtp, resetOtpExpiry | — | password reset |
| signinOtp, signinOtpExpiry, signinOtpAttempts | — | email-OTP signin |
| failedLoginAttempts, lockoutUntil | Number(0), Date\|null | account lockout |
| emailVerified | Boolean | default **true** (pre-existing users default to verified) |

Only unique index is on `email`. Every other model points *at* User via plain string fields, never a Mongoose ref.

### VersionRequest
`fileId` (indexed), `requestedBy`, `stagingS3Key`, `size`, `mimeType`, `isEncrypted` (default false), `originalName`, `changeNote`/`sha256` (optional), `status` enum `pending|approved|rejected` (default pending), `reviewedBy`/`reviewedAt` (default null), `createdAt`. Indexes: `{fileId,status}`, `{requestedBy,status}`.

## DB Stores

| Store | Wraps | Exports (selected) |
|---|---|---|
| `auditStore.ts` | AuditLogModel | `createAuditLog`, `getAuditLogsByFile`, `getAuditLogsByUser` (paginated), `getAuditLogCountByAction` (aggregate), `getAuditLogsByDateRange`, `createViewLogDeduped` (5s default dedup window via a module-level `Map`) |
| `chatStore.ts` | ChatMessageModel + **in-memory** presence map | `getRoomMessages` (last 100), `addMessage`, `clearRoomMessages`; `getRoomOnlineUsers`/`addOnlineUser` (dedup by socketId, capped 1000/room)/`removeOnlineUser`/`removeUserFromAllRooms` (disconnect cleanup) |
| `collaborationStore.ts` | Invitation/FileShare/ShareLink models | 15 functions covering invitations, shares, and share-links CRUD |
| `fileStore.ts` | FileModel | `createFile`, `getFileById`, `getFilesByIds`, `getFilesByUser`, `setAdminOnlyChat`, `updateVersionPolicy`, `updateFileVersionSummary` (mirrors an activated version's fields onto the parent File), `deleteFile`, `getAllFiles` |
| `fileVersionStore.ts` | FileVersionModel + touches FileModel | `getNextVersionNumber`, `createFileVersion`, `getVersionsByFile`, `getVersionById`, `getActiveVersion`, `setActiveVersion` (sequential awaits, not a Mongo transaction), `deleteFileVersion`, `deleteVersionsByFile` |
| `groupStore.ts` | Group/GroupMember/GroupFileShare models | 19 functions across groups, membership, and group-level file shares |
| `inMemoryStore.ts` | **UserModel** (see below) | `findUserByEmail`, `findUserById`, `findUsersByIds`, `findUserByRefreshTokenHash`, `createUser`, `updateUser`, `deleteUser`, `getAllUsers` |
| `notificationStore.ts` | NotificationModel | `createNotification`, `getNotificationsByUser` (default limit 50), `markNotificationRead` (ownership-scoped) |
| `starredStore.ts` | StarredModel | `starFile` (idempotent upsert), `unstarFile`, `getStarredFileIds`, `isFileStarred` |
| `versionRequestStore.ts` | VersionRequestModel | `createVersionRequest`, `getVersionRequestById`, `getUserPendingRequest`, `getUserRecentRequest`, `getUserRejectedRequests`, `getPendingRequestsByFile`, `getPendingRequestsForFiles`, `updateVersionRequestStatus` |

### `db/inMemoryStore.ts` — actually the User store, actually MongoDB

Despite the filename, this file is a thin Mongoose wrapper around `UserModel`, structurally identical to every other `*Store.ts` file — its own header comment reads *"User store backed by MongoDB."* It contains no `Map`/array state at all. It's imported by `auth.service.ts`, `dashboard.service.ts`, `audit.service.ts`, `group.service.ts`, `collaboration.service.ts`, `version.service.ts`, and `routes/test.ts` — login/signup/2FA, dashboard rendering, audit-log user enrichment, sharing, groups, and version workflows all depend on it. A repo-wide check confirms `UserModel` is imported in exactly this one place, so every other module reaches user data only through these exported functions — the same repository-wrapper convention as every other domain.

What's actually stale is **`README.md`**, which still describes this file as *"In-memory user store (swap for DB in production)"* and claims *"the current implementation uses an in-memory store. Data resets on server restart."* That matches an early pre-Mongo prototype (a plain in-process `Map`) whose internals were later fully rewritten to wrap MongoDB — without renaming the file or updating its 7 import sites, and without the README being corrected to match. Treat this as a naming/documentation debt, not a functional gap: renaming to `userStore.ts` and fixing the README would be a safe, purely cosmetic cleanup.

The one genuinely in-memory piece of state left in the entire data layer is `chatStore.ts`'s online-presence map — intentional, ephemeral per-process socket state, unrelated to the above naming confusion.
