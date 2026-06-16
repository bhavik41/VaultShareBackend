import { Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { registerChatHandlers } from "./chatHandlers";
import { disconnectFromAllRooms, getOnlineUsers } from "./roomManager";

let io: SocketIOServer | null = null;

export function initSocketIO(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: process.env.CLIENT_URL ?? "http://localhost:5173",
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log(`[socket.io] client connected: ${socket.id}`);

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
