import express from "express";
import cors from "cors";
import helmet from "helmet";
import authRouter from "./routes/auth";
import filesRouter from "./routes/files";
import collaborationRouter from "./routes/collaboration";
import dashboardRouter from "./routes/dashboard";
import auditRoutes, { activityRouter } from "./routes/audit";
import starredRoutes from "./routes/starred";
import activityRoutes from "./routes/activity";
import chatRouter from "./routes/chat";
import groupsRouter from "./routes/groups";
import versionsRouter, { versionRequestsRouter } from "./routes/versions";
import notificationsRouter from "./routes/notifications";
import documentAIRouter from "./routes/documentAI";
import testRouter from "./routes/test";

const app = express()

// #43-48 — helmet sets X-Content-Type-Options, X-Frame-Options, CSP, HSTS, Referrer-Policy, etc.
app.use(helmet())

const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((s) => s.trim())
app.use(cors({ origin: allowedOrigins, credentials: true }))
app.use(express.json({ limit: "10kb" }))

// Request logger – helps correlate audit log timestamps during debugging
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`)
  next()
})

// ── Routes ────────────────────────────────────────────────────────────────────
app.use("/api/auth", authRouter);
app.use("/api/files", filesRouter);
app.use("/api/files/:fileId/audit", auditRoutes);   // file-level audit history
app.use("/api/audit", activityRouter);               // user activity feed
app.use("/api/collaboration", collaborationRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/starred", starredRoutes);
app.use("/api/activity", activityRoutes);
app.use("/api/chat", chatRouter);
app.use("/api/groups", groupsRouter);
app.use("/api/files/:fileId/versions", versionsRouter);
app.use("/api/version-requests", versionRequestsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/files/:fileId/ask", documentAIRouter);

// Test-only helpers — only mounted when ENABLE_E2E_ROUTES=true
if (process.env.ENABLE_E2E_ROUTES === "true") {
  app.use("/api/test", testRouter);
  console.log("⚠️  E2E test routes enabled — do not use in production");
}

export default app
