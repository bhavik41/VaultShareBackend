import { OnlineUser } from "../types/chat.types";
import {
  addOnlineUser,
  removeOnlineUser,
  getRoomOnlineUsers,
  removeUserFromAllRooms,
} from "../db/chatStore";

// Typing state: fileId → Map<userId, { userName, timerId }>
const typingState = new Map<string, Map<string, { userName: string; timerId: NodeJS.Timeout }>>();

const TYPING_EXPIRY_MS = 5000;

// ── Online user management ─────────────────────────────────────────────────────

export function joinRoom(fileId: string, user: OnlineUser): void {
  addOnlineUser(fileId, user);
}

export function leaveRoom(fileId: string, socketId: string): OnlineUser | null {
  clearTypingForSocket(fileId, socketId);
  return removeOnlineUser(fileId, socketId);
}

export function disconnectFromAllRooms(
  socketId: string,
): Array<{ fileId: string; user: OnlineUser }> {
  // Clear any typing indicators this socket may have set
  for (const [fileId, users] of typingState.entries()) {
    for (const [userId, state] of users.entries()) {
      // We identify by socketId stored in onlineUsers — check before clearing
      void fileId; void userId; void state;
    }
  }
  clearTypingForSocketAllRooms(socketId);
  return removeUserFromAllRooms(socketId);
}

export function getOnlineUsers(fileId: string): OnlineUser[] {
  return getRoomOnlineUsers(fileId);
}

// ── Typing indicator management ────────────────────────────────────────────────

/**
 * Mark a user as typing. Automatically clears after TYPING_EXPIRY_MS if
 * stop_typing is never received.
 *
 * Returns a callback that should be invoked to broadcast the cleared state
 * when the timer fires.
 */
export function setTyping(
  fileId: string,
  userId: string,
  userName: string,
  onExpire: (fileId: string, userId: string, userName: string) => void,
): void {
  if (!typingState.has(fileId)) {
    typingState.set(fileId, new Map());
  }
  const roomTyping = typingState.get(fileId)!;

  // Clear existing timer for this user if present
  if (roomTyping.has(userId)) {
    clearTimeout(roomTyping.get(userId)!.timerId);
  }

  const timerId = setTimeout(() => {
    roomTyping.delete(userId);
    if (roomTyping.size === 0) typingState.delete(fileId);
    onExpire(fileId, userId, userName);
  }, TYPING_EXPIRY_MS);

  roomTyping.set(userId, { userName, timerId });
}

export function clearTyping(
  fileId: string,
  userId: string,
): { userName: string } | null {
  const roomTyping = typingState.get(fileId);
  if (!roomTyping) return null;
  const entry = roomTyping.get(userId);
  if (!entry) return null;
  clearTimeout(entry.timerId);
  roomTyping.delete(userId);
  if (roomTyping.size === 0) typingState.delete(fileId);
  return { userName: entry.userName };
}

function clearTypingForSocket(fileId: string, socketId: string): void {
  // We don't track socketId→userId in typing state; clear all if needed
  // The online users list is already being removed — just flush by socketId via onlineUsers
  const onlineUsers = getRoomOnlineUsers(fileId);
  const user = onlineUsers.find((u) => u.socketId === socketId);
  if (user) {
    clearTyping(fileId, user.userId);
  }
}

function clearTypingForSocketAllRooms(socketId: string): void {
  for (const [fileId] of typingState.entries()) {
    clearTypingForSocket(fileId, socketId);
  }
}
