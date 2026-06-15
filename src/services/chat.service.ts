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
export function saveMessage(
  fileId: string,
  userId: string,
  userName: string,
  content: string,
): ChatMessage {
  const message: ChatMessage = {
    id: uuidv4(),
    fileId,
    userId,
    userName,
    content,
    timestamp: new Date().toISOString(),
  };
  addMessage(message);
  return message;
}

/**
 * Retrieve messages for a room, optionally filtered by `before` timestamp
 * and capped to `limit`.
 */
export function getMessages(
  fileId: string,
  limit = 50,
  before?: string,
): ChatMessage[] {
  let messages = getRoomMessages(fileId);

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
export function clearRoom(fileId: string): void {
  clearRoomMessages(fileId);
}
