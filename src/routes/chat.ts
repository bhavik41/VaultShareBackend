import { Router } from "express";
import { authenticate } from "../middleware/auth";
import { getMessageHistory, getOnlineUsersForRoom } from "../controllers/chat.controller";

const chatRouter = Router();

// GET /api/chat/:fileId/messages?limit=50&before=<ISO timestamp>
chatRouter.get("/:fileId/messages", authenticate, getMessageHistory);

// GET /api/chat/:fileId/online
chatRouter.get("/:fileId/online", authenticate, getOnlineUsersForRoom);

export default chatRouter;
