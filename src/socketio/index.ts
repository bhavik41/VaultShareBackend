import { Server as HttpServer } from "http";
import { Server as SocketIOServer, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { registerChatHandlers } from "./chatHandlers";
import { disconnectFromAllRooms, getOnlineUsers } from "./roomManager";
import { UserPayload } from "../types/index";

let io: SocketIOServer | null = null;

export function initSocketIO(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL ?? "http://localhost:5173",
      credentials: true,
    },
  });

  // #61 — Rate limit Socket.IO connections per IP
  const connectionLimit = new Map<string, { count: number; resetTime: number }>();
  io.use((socket: Socket, next) => {
    const ip = socket.handshake.address;
    const now = Date.now();
    let record = connectionLimit.get(ip);
    
    // 1-minute window, max 20 connections per IP
    if (!record || now > record.resetTime) {
      record = { count: 1, resetTime: now + 60000 };
    } else {
      record.count++;
      if (record.count > 20) {
        return next(new Error("Rate limit exceeded. Try again later."));
      }
    }
    connectionLimit.set(ip, record);
    next();
  });

  // #23 — JWT authentication on Socket.IO connection handshake
  io.use((socket: Socket, next) => {
    const token =
      (socket.handshake.auth?.token as string | undefined) ??
      (socket.handshake.headers?.authorization as string | undefined)?.replace(
        /^Bearer\s+/i,
        "",
      );

    if (!token) {
      return next(new Error("Authentication error: no token provided"));
    }

    try {
      const secret = process.env.JWT_SECRET;
      if (!secret) return next(new Error("Server configuration error"));
      const decoded = jwt.verify(token, secret) as UserPayload;
      // #24 — store verified identity in socket.data so handlers never trust client-supplied userId
      socket.data.user = decoded;
      next();
    } catch {
      next(new Error("Authentication error: invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(
      `[socket.io] client connected: ${socket.id} (user: ${socket.data.user?.id})`,
    );

    // Register all chat-related event handlers
    registerChatHandlers(io!, socket);

    // ── disconnect ─────────────────────────────────────────────────────────────
    socket.on("disconnect", () => {
      console.log(`[socket.io] client disconnected: ${socket.id}`);

      const evacuated = disconnectFromAllRooms(socket.id);

      for (const { fileId, user } of evacuated) {
        const onlineUsers = getOnlineUsers(fileId);
        io!.to(fileId).emit("user_left", {
          userId: user.userId,
          userName: user.userName,
          onlineUsers,
        });
        console.log(
          `[chat] ${user.userName} removed from room ${fileId} on disconnect`,
        );
      }
    });
  });

  console.log("[socket.io] server initialized");
  return io;
}

export function getIO(): SocketIOServer {
  if (!io) throw new Error("Socket.IO has not been initialized yet");
  return io;
}
