import express from "express";
import cors from "cors";
import authRouter from "./routes/auth";
import filesRouter from "./routes/files";
import collaborationRouter from "./routes/collaboration";
import dashboardRouter from "./routes/dashboard";
import auditRouter from "./routes/audit";

const app = express();

// ── Middleware ────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173")
  .split(",")
  .map((o) => o.trim());

app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/files", filesRouter);
app.use("/api/files/:fileId/audit", auditRouter);
app.use("/api/collaboration", collaborationRouter);
app.use("/api/dashboard", dashboardRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// 404 handler
app.use((_req, res) => {
  res.status(404).json({ message: "Route not found" });
});

export default app;
