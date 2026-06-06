import { Router } from "express"
import { AuthController } from "../controllers/auth.controller.js"
import { authenticate } from "../middleware/auth.js"

const router = Router()

router.post("/signup", AuthController.signup)
router.post("/signin", AuthController.signin)
router.post("/refresh", AuthController.refresh)
router.post("/logout", authenticate, AuthController.logout)
router.get("/me", authenticate, AuthController.me)

router.post("/forgot-password", AuthController.forgotPassword)
router.post("/reset-password", AuthController.resetPassword)

router.post("/2fa/setup", authenticate, AuthController.setup2fa)
router.post("/2fa/verify", authenticate, AuthController.verify2fa)
router.post("/2fa/validate", AuthController.validate2fa)
router.delete("/2fa/disable", authenticate, AuthController.disable2fa)

export default router
