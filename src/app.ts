import express from "express";
import cors from "cors";
import authRouter from "./routes/auth";
import filesRouter from "./routes/files";
import collaborationRouter from "./routes/collaboration";
import dashboardRouter from "./routes/dashboard";
import auditRoutes, { activityRouter } from "./routes/audit";
import starredRoutes from "./routes/starred";
import activityRoutes from "./routes/activity";

const app = express()

app.use(cors({ origin: process.env.CLIENT_URL ?? "http://localhost:5173", credentials: true }))
app.use(express.json())

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

export default app
