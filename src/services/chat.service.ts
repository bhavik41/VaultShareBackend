import { v4 as uuidv4 } from "../utils/uuid";
import { ChatMessage } from "../types/chat.types";
import {
  addMessage,
  getRoomMessages,
  clearRoomMessages,
} from "../db/chatStore";

/**
 * Persist a new chat message and return the saved record.
 */
export async function saveMessage(
  fileId: string,
  userId: string,
  userName: string,
  userEmail: string,
  content: string,
): Promise<ChatMessage> {
  const message: ChatMessage = {
    id: uuidv4(),
    fileId,
    userId,
    userName,
    userEmail,
    content,
    timestamp: new Date().toISOString(),
  };
  await addMessage(message);
  return message;
}

/**
 * Retrieve messages for a room, optionally filtered by `before` timestamp
 * and capped to `limit`.
 */
export async function getMessages(
  fileId: string,
  limit = 50,
  before?: string,
): Promise<ChatMessage[]> {
  let messages = await getRoomMessages(fileId);

  if (before) {
    const beforeDate = new Date(before).getTime();
    messages = messages.filter((m) => new Date(m.timestamp).getTime() < beforeDate);
  }

  // Return the most recent `limit` messages in chronological order
  return messages.slice(-limit);
}

/**
 * Clear all messages for a room (e.g., when a file is deleted).
 */
export async function clearRoom(fileId: string): Promise<void> {
  await clearRoomMessages(fileId);
}
