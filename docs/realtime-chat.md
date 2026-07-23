# Real-Time Chat (Socket.IO Server)

Server-side counterpart to the frontend's `useChat` hook (see the frontend's [components.md](../../VaultShareFrontened/docs/components.md#real-time-chat-deep-dive)). One Socket.IO room per file (`fileId`).

## `socketio/index.ts` — server setup

`initSocketIO(httpServer)` creates the singleton `SocketIOServer` (retrievable later via `getIO()`, which throws if called before init).

- **CORS**: `origin: process.env.CLIENT_URL ?? "http://localhost:5173"`, `credentials: true`. No explicit `transports` restriction — Socket.IO's default negotiation (polling first, upgrading to WebSocket) applies.
- **Handshake middleware chain** (`io.use`, in order):
  1. **Per-IP connection rate limit** — in-memory map, max 20 connections/IP per rolling 60s window; over the limit → `connect_error`.
  2. **JWT auth** — reads the token from `socket.handshake.auth.token` or an `Authorization: Bearer` header, verifies with `jwt.verify(token, JWT_SECRET)`, stores the decoded `UserPayload` on `socket.data.user`. Missing/invalid token rejects the connection before any handler runs — nothing from the client is trusted for identity beyond this point.
- **`connection` handler**: registers all chat events (`registerChatHandlers`) and a `disconnect` handler that evacuates the socket from every room it was in, emitting `user_left` to each.

## `socketio/chatHandlers.ts` — event handlers

`authedUser` is snapshotted once per connection; every handler re-derives `userId`/`userName` from it, **never from the client payload** — the payload types still declare `userId`/`userName` fields (a pre-JWT-hardening leftover), but they're silently ignored.

| Event | Validation | Effect |
|---|---|---|
| `join_room {fileId}` | non-empty string, authenticated, ≤100 rooms/socket | Joins the roster + `socket.join`; emits `message_history` (last 50), `admin_only_changed` (current state), `online_users` to the joiner only; broadcasts `user_joined` to everyone else |
| `leave_room {fileId}` | same | Removes from roster + `socket.leave`; broadcasts `user_left` to the **whole room including the leaver** |
| `send_message {fileId, userEmail, content}` | fileId/auth + `content` non-empty ≤2000 chars | Enforces admin-only mode (see below); persists; broadcasts `message_received` to the whole room including sender; fires an audit log (`action: "share"`) |
| `set_admin_only {fileId, adminOnly}` | owner-only | Persists to the File doc; broadcasts `admin_only_changed` to the whole room |
| `typing {fileId}` | silent no-op if missing (no error emitted) | Arms/resets a 5s timer; broadcasts `typing_indicator {isTyping:true}` to everyone else |
| `stop_typing {fileId}` | silent no-op if missing | Clears the timer; broadcasts `typing_indicator {isTyping:false}` to everyone else |

## `socketio/roomManager.ts` — presence & typing orchestration

Doesn't hold the online-user list itself — delegates to `db/chatStore.ts`'s in-memory presence map. Its own state is `typingState: Map<fileId, Map<userId, {userName, timerId}>>`, capped at 1000 rooms / 50 typing users per room (over-cap entries are silently dropped).

- `joinRoom`/`leaveRoom`/`getOnlineUsers` delegate to `chatStore`'s `addOnlineUser`/`removeOnlineUser`/`getRoomOnlineUsers`.
- `leaveRoom` clears any typing timer for that socket *before* removing it from the roster (typing state is keyed by `userId`, looked up via the still-present roster entry).
- `disconnectFromAllRooms(socketId)` clears typing state across every room, then calls `chatStore.removeUserFromAllRooms(socketId)`, which returns every `{fileId, user}` pair the socket belonged to — driving the multi-room `user_left` broadcast loop in `index.ts`.
- `setTyping` arms a 5000ms (`TYPING_EXPIRY_MS`) timeout; on expiry it invokes a caller-supplied `onExpire` callback (used to broadcast a synthetic `typing_indicator {isTyping:false}` even if the client never explicitly sent `stop_typing` — e.g. a dropped connection or navigating away).

## REST counterpart — `controllers/chat.controller.ts`

- **`getMessageHistory`** (`GET /api/chat/:fileId/messages?limit=&before=`) — clamps `limit` to `[?, 200]` (default 50), matches `useChat`'s mount-time REST bootstrap.
- **`getOnlineUsersForRoom`** (`GET /api/chat/:fileId/online`) — calls `roomManager.getOnlineUsers` directly, bypassing the service layer; for polling clients without a live socket.

**Neither route checks file permissions** — only a valid JWT is required (see [Known issues](architecture.md#known-issues--inconsistencies)).

## `services/chat.service.ts` / `db/chatStore.ts`

- `saveMessage` builds the message object (uuid + ISO timestamp) and persists it — the exact same object returned is what gets broadcast as `message_received`, not a re-fetched copy.
- `getMessages(fileId, limit=50, before?)` — the underlying store fetch caps at **100 messages**; `before`-cursor pagination can only page *within* that top-100 window, so deep history beyond the most recent 100 isn't reachable through this path.
- `clearRoom(fileId)` exists but is **never called** anywhere in the codebase — dead code, not wired into file deletion.
- Messages persist to MongoDB (`ChatMessageModel`); online presence is an **intentional in-memory-only** `Map<fileId, OnlineUser[]>` inside `chatStore.ts` (capped 1000 users/room), since socket presence has no meaning across a restart.

## `models/ChatMessage.ts`

`_id: String` (app-generated UUID, not ObjectId), `fileId` (indexed), `userId`, `userName`, `userEmail` (default `''`), `content`, `timestamp` (default now). Compound index `{fileId:1, timestamp:1}`.

## `scripts/testChat.ts`

Contains **no executable code** — a block comment (ending in a bare `export {}`) documenting how to drive the socket API with `socket.io-client`: connect → `join_room` → observe `message_history`/`online_users`/`user_joined` → `send_message` → `message_received` → `typing`/`stop_typing` → `typing_indicator` → `leave_room` → `user_left`, plus the two REST endpoints and the generic `error` event. It's living usage documentation, not an automated test.

## Full server-side event contract

| Event | Direction | Payload | Trigger |
|---|---|---|---|
| `join_room` | client→server | `{fileId}` | — |
| `leave_room` | client→server | `{fileId}` | — |
| `send_message` | client→server | `{fileId, userEmail, content}` | — |
| `typing` / `stop_typing` | client→server | `{fileId}` | — |
| `set_admin_only` | client→server | `{fileId, adminOnly}` | — |
| `message_history` | server→client (joiner only) | `{messages: ChatMessage[]}` (last 50) | End of `join_room` |
| `admin_only_changed` | server→client (joiner only on join; whole room on toggle) | `{fileId, adminOnly, ownerId}` | `join_room` bootstrap **and** `set_admin_only` broadcast — same event, two triggers |
| `online_users` | server→client (joiner only) | `{users: OnlineUser[]}` | End of `join_room` |
| `user_joined` | server→client (room minus joiner) | `{userId, userName, onlineUsers}` | End of `join_room` |
| `user_left` | server→client (whole room) | `{userId, userName, onlineUsers}` | `leave_room`, and per-room on socket `disconnect` |
| `message_received` | server→client (whole room incl. sender) | `ChatMessage` | Successful `send_message` |
| `typing_indicator` | server→client (room minus originator) | `{userId, userName, isTyping}` | `typing` (true), `stop_typing` (false), or the 5s server-side expiry timer (false) |
| `error` | server→client (sender only) | `{message}` | Validation/auth/authorization failure in any handler except `typing`/`stop_typing` (which fail silently) |

## Admin-only chat: full trace

**Persistence**: a single boolean, `adminOnlyChat` (default false), lives directly on the `File` document. "Admin" strictly means the file's **owner** (`file.userId`) — there's no separate role check against `Collaboration`.

1. Client emits `set_admin_only {fileId, adminOnly}`.
2. Server validates `fileId`/auth, fetches the file (404-equivalent `error` event if missing).
3. **Authorization**: `file.userId !== userId` → `error: "Only the file owner can change admin-only mode."`
4. On success, persists via `FileModel.findByIdAndUpdate` and broadcasts `admin_only_changed {fileId, adminOnly, ownerId}` to the entire room, including the toggling owner.
5. **Enforcement**: every `send_message` re-fetches the file fresh (not a cached flag) and rejects with an `error` if `adminOnlyChat && file.userId !== userId` — the message is never persisted or broadcast. Because it's a live DB read per send, a toggle takes effect immediately for the next send attempt from anyone.
6. **Bootstrap**: `join_room` also emits `admin_only_changed` to the joining socket alone, seeded from current state — the same event name/shape serves both initial hydration and live updates, distinguished only by who receives it and when.

This matches the frontend's `useChat` hook, which exposes `adminOnlyChat`/`ownerId`/`setAdminOnly` and consumes exactly this event (see the frontend's [components.md](../../VaultShareFrontened/docs/components.md)).
