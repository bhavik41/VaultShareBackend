import express from "express"
import cors from "cors"
import authRoutes from "./routes/auth"
import fileRoutes from "./routes/files"
import auditRoutes, { activityRouter } from "./routes/audit"
import collaborationRoutes from "./routes/collaboration"
import dashboardRoutes from "./routes/dashboard"
import starredRoutes from "./routes/starred"
import activityRoutes from "./routes/activity"

const app = express()

app.use(cors({ origin: process.env.CLIENT_URL ?? "http://localhost:5173", credentials: true }))
app.use(express.json())

// Request logger â€” helps correlate audit log timestamps during debugging
app.use((req, _res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`)
  next()
})

app.use("/api/auth", authRoutes)
app.use("/api/files", fileRoutes)
app.use("/api/files/:fileId/audit", auditRoutes)  // file-level audit history
app.use("/api/audit", activityRouter)              // user activity feed
app.use("/api/collaboration", collaborationRoutes)
app.use("/api/dashboard", dashboardRoutes)
app.use("/api/starred", starredRoutes)
app.use("/api/activity", activityRoutes)

export default app
