import { Router } from "express"
import { authenticate } from "../middleware/auth"
import { CollaborationController } from "../controllers/collaboration.controller"

const router = Router()

router.get("/pending", authenticate, CollaborationController.getPendingInvitations)
router.post("/invite", authenticate, CollaborationController.inviteCollaborator)
router.post("/accept/:invitationId", authenticate, CollaborationController.acceptInvitation)
router.post("/reject/:invitationId", authenticate, CollaborationController.rejectInvitation)

// Owner-only: change role of a collaborator
router.patch("/:fileId/role/:userId", authenticate, CollaborationController.changeRole)

// Owner-only: revoke collaborator access and log revoke_access audit event
router.delete("/:fileId/revoke/:userId", authenticate, CollaborationController.revokeAccess)

export default router
