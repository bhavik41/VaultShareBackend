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
import previewPdfRouter from "./routes/previewPdf";
import testRouter from "./routes/test";

const app = express()

// Fix #7 — trust the first proxy hop so req.ip reflects the real client IP,
// which makes all express-rate-limit per-IP windows work correctly behind nginx/ALB.
app.set("trust proxy", 1)

app.use(
  helmet({
    // HSTS: tell browsers to only use HTTPS for 1 year, including subdomains
    strictTransportSecurity: {
      maxAge: 31_536_000,
      includeSubDomains: true,
    },
    xContentTypeOptions: true,
    // X-Frame-Options: DENY — no iframing at all
    frameguard: { action: "deny" },
    // Referrer-Policy: only send origin when crossing schemes/hosts
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    // CSP: lock down script/style/connect sources; allow same-origin fetch for API calls
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        // Allow fetch to S3 for presigned download URLs
        connectSrc: ["'self'", "https://*.amazonaws.com"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'", "blob:"],
        frameSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        upgradeInsecureRequests: [],
      },
    },
  }),
)

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
app.use("/api/files/:fileId/preview-pdf", previewPdfRouter);

// Test-only helpers — only mounted when ENABLE_E2E_ROUTES=true
if (process.env.ENABLE_E2E_ROUTES === "true") {
  app.use("/api/test", testRouter);
  console.log("⚠️  E2E test routes enabled — do not use in production");
}

export default app
