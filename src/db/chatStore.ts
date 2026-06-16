import { ChatMessage, OnlineUser } from "../types/chat.types";
import { ChatMessageModel } from "../models/ChatMessage";

// Maximum number of messages returned per room.
export const MAX_MESSAGES_PER_ROOM = 100;

// Map of fileId → array of OnlineUsers (ephemeral socket-connection state,
// intentionally kept in memory — it has no meaning across restarts).
const onlineUserStore = new Map<string, OnlineUser[]>();

// ── Message helpers (MongoDB-backed) ────────────────────────────────────────────

export async function getRoomMessages(fileId: string): Promise<ChatMessage[]> {
  const docs = await ChatMessageModel.find({ fileId })
    .sort({ timestamp: 1 })
    .limit(MAX_MESSAGES_PER_ROOM)
    .lean();
  return docs.map((d) => ({
    id: d._id,
    fileId: d.fileId,
    userId: d.userId,
    userName: d.userName,
    userEmail: d.userEmail ?? '',
    content: d.content,
    timestamp: d.timestamp.toISOString(),
  }));
}

export async function addMessage(message: ChatMessage): Promise<void> {
  await ChatMessageModel.create({
    _id: message.id,
    fileId: message.fileId,
    userId: message.userId,
    userName: message.userName,
    userEmail: message.userEmail,
    content: message.content,
    timestamp: new Date(message.timestamp),
  });
}

export async function clearRoomMessages(fileId: string): Promise<void> {
  await ChatMessageModel.deleteMany({ fileId });
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
