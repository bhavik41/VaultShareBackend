import "dotenv/config";
import http from "http";
import app from "./app";
import { initSocketIO } from "./socketio";
import { connectDB } from "./db/mongoose";

const PORT = parseInt(process.env.PORT ?? "5000", 10);

const httpServer = http.createServer(app);

// #70, #71 - Prevent Slowloris attacks by closing slow/idle connections
httpServer.requestTimeout = 30000;
httpServer.timeout = 120000;

// Attach Socket.IO to the HTTP server
initSocketIO(httpServer);

async function start() {
  await connectDB();
  httpServer.listen(PORT, () => {
    console.log(`🚀 VaultShare API running on http://localhost:${PORT}`);
    console.log(`   Environment: ${process.env.NODE_ENV ?? "development"}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
