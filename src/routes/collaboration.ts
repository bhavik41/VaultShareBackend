import { Router } from "express";
import { CollaborationController } from "../controllers/collaboration.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

router.use(authenticate);

router.post(
  "/files/:fileId/invitations",
  CollaborationController.inviteCollaborator,
);

router.get("/invitations", CollaborationController.listMyInvitations);

router.get(
  "/files/:fileId/invitations",
  CollaborationController.listFileInvitations,
);

router.patch(
  "/invitations/:invitationId/respond",
  CollaborationController.respondToInvitation,
);

export default router;