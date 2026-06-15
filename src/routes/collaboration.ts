import { Router } from "express";
import { CollaborationController } from "../controllers/collaboration.controller";
import { authenticate } from "../middleware/auth";

const router = Router();

router.get("/share-links/:token", CollaborationController.validateShareLink);

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

router.get(
  "/files/:fileId/shared-users",
  CollaborationController.listSharedUsers,
);

router.patch(
  "/files/:fileId/collaborators/:userId",
  CollaborationController.updateCollaboratorPermission,
);

router.delete(
  "/files/:fileId/collaborators/:userId",
  CollaborationController.removeCollaborator,
);

router.get("/shared-with-me", CollaborationController.listFilesSharedWithMe);

router.post(
  "/files/:fileId/share-links",
  CollaborationController.createShareLink,
);

router.get(
  "/files/:fileId/share-links",
  CollaborationController.listShareLinks,
);

router.delete(
  "/share-links/:token",
  CollaborationController.revokeShareLink,
);

// Routes added by feature/backend-audit-log
router.get("/pending", CollaborationController.getPendingInvitations);
router.post("/accept/:invitationId", CollaborationController.acceptInvitation);
router.post("/reject/:invitationId", CollaborationController.rejectInvitation);
router.patch("/:fileId/role/:userId", CollaborationController.changeRole);
router.delete("/:fileId/revoke/:userId", CollaborationController.revokeAccess);

export default router;
