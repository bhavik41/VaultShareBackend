import "dotenv/config";
import http from "http";
import app from "./app";
import { initSocketIO } from "./socketio";

const PORT = parseInt(process.env.PORT ?? "5000", 10);

const httpServer = http.createServer(app);

// Attach Socket.IO to the HTTP server
initSocketIO(httpServer);

httpServer.listen(PORT, () => {
  console.log(`🚀 VaultShare API running on http://localhost:${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV ?? "development"}`);
});
