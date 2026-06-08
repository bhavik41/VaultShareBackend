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

router.post("/files/:fileId/share", CollaborationController.shareFileWithUser);

router.get("/files/:fileId/shared-users", CollaborationController.listSharedUsers);

router.patch(
  "/files/:fileId/collaborators/:userId",
  CollaborationController.updateCollaboratorPermission,
);

router.delete(
  "/files/:fileId/collaborators/:userId",
  CollaborationController.removeCollaborator,
);

router.get("/shared-with-me", CollaborationController.listFilesSharedWithMe);

export default router;