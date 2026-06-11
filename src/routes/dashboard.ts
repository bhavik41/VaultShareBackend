import { Router } from "express";
import { DashboardController } from "../controllers/dashboard.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

router.use(authenticate);

router.get("/", DashboardController.overview);
router.get("/documents", DashboardController.documents);
router.get("/stats", DashboardController.stats);
router.get("/activity", DashboardController.activity);

export default router;
