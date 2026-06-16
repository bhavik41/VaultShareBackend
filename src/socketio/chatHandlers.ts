import { Server as SocketIOServer, Socket } from "socket.io";
import {
  JoinRoomPayload,
  LeaveRoomPayload,
  SendMessagePayload,
  SetAdminOnlyPayload,
  TypingPayload,
  StopTypingPayload,
  OnlineUser,
} from "../types/chat.types";
import { saveMessage, getMessages } from "../services/chat.service";
import { joinRoom, leaveRoom, getOnlineUsers, setTyping, clearTyping } from "./roomManager";
import { getFileById, setAdminOnlyChat } from "../db/fileStore";
import * as auditService from "../services/audit.service";

const MAX_CONTENT_LENGTH = 2000;

function validateContent(content: unknown): content is string {
  return (
    typeof content === "string" &&
    content.trim().length > 0 &&
    content.length <= MAX_CONTENT_LENGTH
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function registerChatHandlers(io: SocketIOServer, socket: Socket): void {
  // ── join_room ────────────────────────────────────────────────────────────────
  socket.on("join_room", async (payload: JoinRoomPayload) => {
    const { fileId, userId, userName } = payload ?? {};

    if (!isNonEmptyString(fileId) || !isNonEmptyString(userId) || !isNonEmptyString(userName)) {
      socket.emit("error", { message: "join_room: fileId, userId and userName are required" });
      return;
    }

    const onlineUser: OnlineUser = { userId, userName, socketId: socket.id };
    joinRoom(fileId, onlineUser);
    socket.join(fileId);

    // Send message history to the joining client
    const messages = await getMessages(fileId, 50);
    socket.emit("message_history", { messages });

    // Send the current admin-only-chat state (and the file owner) so the
    // client can render the lock UI and decide whether it may send.
    const file = await getFileById(fileId);
    socket.emit("admin_only_changed", {
      fileId,
      adminOnly: file?.adminOnlyChat ?? false,
      ownerId: file?.userId ?? null,
    });

    // Send current online users to the joining client immediately
    const onlineUsers = getOnlineUsers(fileId);
    socket.emit("online_users", { users: onlineUsers });

    // Notify ALL other clients in the room (excluding the joining client) that a new user joined,
    // including the refreshed online users list so they can update their UI.
    socket.to(fileId).emit("user_joined", { userId, userName, onlineUsers });

    console.log(`[chat] ${userName} (${userId}) joined room ${fileId}`);
  });

  // ── leave_room ───────────────────────────────────────────────────────────────
  socket.on("leave_room", (payload: LeaveRoomPayload) => {
    const { fileId, userId } = payload ?? {};

    if (!isNonEmptyString(fileId) || !isNonEmptyString(userId)) {
      socket.emit("error", { message: "leave_room: fileId and userId are required" });
      return;
    }

    const removed = leaveRoom(fileId, socket.id);
    socket.leave(fileId);

    const onlineUsers = getOnlineUsers(fileId);
    const userName = removed?.userName ?? userId;
    io.to(fileId).emit("user_left", { userId, userName, onlineUsers });

    console.log(`[chat] ${userName} (${userId}) left room ${fileId}`);
  });

  // ── send_message ─────────────────────────────────────────────────────────────
  socket.on("send_message", async (payload: SendMessagePayload) => {
    const { fileId, userId, userName, userEmail, content } = payload ?? {};

    if (!isNonEmptyString(fileId) || !isNonEmptyString(userId) || !isNonEmptyString(userName)) {
      socket.emit("error", { message: "send_message: fileId, userId and userName are required" });
      return;
    }

    if (!validateContent(content)) {
      socket.emit("error", {
        message: `send_message: content must be a non-empty string (max ${MAX_CONTENT_LENGTH} chars)`,
      });
      return;
    }

    // Enforce admin-only chat: when enabled, only the file owner may send.
    const file = await getFileById(fileId);
    if (file?.adminOnlyChat && file.userId !== userId) {
      socket.emit("error", {
        message: "Admin-only mode is enabled. Only the file owner can send messages.",
      });
      return;
    }

    const message = await saveMessage(fileId, userId, userName, userEmail ?? '', content.trim());

    // Broadcast to all clients in the room (including sender)
    io.to(fileId).emit("message_received", message);

    // Log the chat message send event to the audit service.
    // We use "share" as the closest semantic AuditAction for a collaboration event.
    auditService.logAction(fileId, userId, "share", `chat: ${content.slice(0, 100)}`);

    console.log(`[chat] message in room ${fileId} from ${userName}`);
  });

  // ── set_admin_only ─────────────────────────────────────────────────────────────
  // Only the file owner may toggle admin-only chat. The new state is persisted
  // and broadcast to everyone in the room so all clients update their UI.
  socket.on("set_admin_only", async (payload: SetAdminOnlyPayload) => {
    const { fileId, userId, adminOnly } = payload ?? {};

    if (!isNonEmptyString(fileId) || !isNonEmptyString(userId)) {
      socket.emit("error", { message: "set_admin_only: fileId and userId are required" });
      return;
    }

    const file = await getFileById(fileId);
    if (!file) {
      socket.emit("error", { message: "set_admin_only: file not found" });
      return;
    }

    // Authorization: only the owner can change this setting.
    if (file.userId !== userId) {
      socket.emit("error", { message: "Only the file owner can change admin-only mode." });
      return;
    }

    const updated = await setAdminOnlyChat(fileId, !!adminOnly);

    io.to(fileId).emit("admin_only_changed", {
      fileId,
      adminOnly: updated?.adminOnlyChat ?? !!adminOnly,
      ownerId: file.userId,
    });

    console.log(`[chat] admin-only for room ${fileId} set to ${!!adminOnly} by owner ${userId}`);
  });

  // ── typing ───────────────────────────────────────────────────────────────────
  socket.on("typing", (payload: TypingPayload) => {
    const { fileId, userId, userName } = payload;

    if (!fileId || !userId || !userName) return;

    setTyping(fileId, userId, userName, (fId, uId, uName) => {
      // Auto-expire: broadcast stop to others in the room
      socket.to(fId).emit("typing_indicator", { userId: uId, userName: uName, isTyping: false });
    });

    socket.to(fileId).emit("typing_indicator", { userId, userName, isTyping: true });
  });

  // ── stop_typing ──────────────────────────────────────────────────────────────
  socket.on("stop_typing", (payload: StopTypingPayload) => {
    const { fileId, userId } = payload;

    if (!fileId || !userId) return;

    const cleared = clearTyping(fileId, userId);
    if (cleared) {
      socket.to(fileId).emit("typing_indicator", {
        userId,
        userName: cleared.userName,
        isTyping: false,
      });
    }
  });
}
