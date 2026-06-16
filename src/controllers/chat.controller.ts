import { Request, Response } from "express";
import { getMessages } from "../services/chat.service";
import { getOnlineUsers } from "../socketio/roomManager";

/**
 * GET /api/chat/:fileId/messages?limit=50&before=<ISO timestamp>
 *
 * Returns paginated chat history for a file room.
 */
export async function getMessageHistory(req: Request, res: Response): Promise<void> {
  const { fileId } = req.params;
  const limit = Math.min(parseInt((req.query.limit as string) ?? "50", 10), 200);
  const before = req.query.before as string | undefined;

  if (!fileId) {
    res.status(400).json({ message: "fileId is required" });
    return;
  }

  const messages = await getMessages(fileId, isNaN(limit) ? 50 : limit, before);
  res.json({ messages });
}

/**
 * GET /api/chat/:fileId/online
 *
 * Returns the list of currently connected users in a file room.
 * Useful for polling-based clients that do not maintain a socket connection.
 */
export function getOnlineUsersForRoom(req: Request, res: Response): void {
  const { fileId } = req.params;

  if (!fileId) {
    res.status(400).json({ message: "fileId is required" });
    return;
  }

  const users = getOnlineUsers(fileId);
  res.json({ users, count: users.length });
}
