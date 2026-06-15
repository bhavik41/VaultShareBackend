import { ChatMessage, OnlineUser } from "../types/chat.types";

// Maximum number of messages retained per room (FIFO eviction)
export const MAX_MESSAGES_PER_ROOM = 100;

// Map of fileId → array of ChatMessages (ordered oldest-first)
const messageStore = new Map<string, ChatMessage[]>();

// Map of fileId → array of OnlineUsers
const onlineUserStore = new Map<string, OnlineUser[]>();

// ── Message helpers ────────────────────────────────────────────────────────────

export function getRoomMessages(fileId: string): ChatMessage[] {
  return messageStore.get(fileId) ?? [];
}

export function addMessage(message: ChatMessage): void {
  const messages = messageStore.get(message.fileId) ?? [];
  messages.push(message);
  // Evict oldest messages when cap is exceeded
  if (messages.length > MAX_MESSAGES_PER_ROOM) {
    messages.splice(0, messages.length - MAX_MESSAGES_PER_ROOM);
  }
  messageStore.set(message.fileId, messages);
}

export function clearRoomMessages(fileId: string): void {
  messageStore.delete(fileId);
}

// ── Online-user helpers ────────────────────────────────────────────────────────

export function getRoomOnlineUsers(fileId: string): OnlineUser[] {
  return onlineUserStore.get(fileId) ?? [];
}

export function addOnlineUser(fileId: string, user: OnlineUser): void {
  const users = onlineUserStore.get(fileId) ?? [];
  // Avoid duplicates — remove any existing entry for this socket
  const filtered = users.filter((u) => u.socketId !== user.socketId);
  filtered.push(user);
  onlineUserStore.set(fileId, filtered);
}

export function removeOnlineUser(fileId: string, socketId: string): OnlineUser | null {
  const users = onlineUserStore.get(fileId) ?? [];
  const idx = users.findIndex((u) => u.socketId === socketId);
  if (idx === -1) return null;
  const [removed] = users.splice(idx, 1);
  onlineUserStore.set(fileId, users);
  return removed;
}

export function removeUserFromAllRooms(socketId: string): Array<{ fileId: string; user: OnlineUser }> {
  const removed: Array<{ fileId: string; user: OnlineUser }> = [];
  for (const [fileId, users] of onlineUserStore.entries()) {
    const idx = users.findIndex((u) => u.socketId === socketId);
    if (idx !== -1) {
      const [user] = users.splice(idx, 1);
      onlineUserStore.set(fileId, users);
      removed.push({ fileId, user });
    }
  }
  return removed;
}

export function clearRoomOnlineUsers(fileId: string): void {
  onlineUserStore.delete(fileId);
}
