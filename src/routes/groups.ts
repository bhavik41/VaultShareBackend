import { Router } from 'express'
import { GroupController } from '../controllers/group.controller'
import { authenticate } from '../middleware/auth'

const router = Router()

router.use(authenticate)

// ── Groups ────────────────────────────────────────────────────────────────────
router.post('/', GroupController.createGroup)
router.get('/', GroupController.listMyGroups)
router.get('/files-shared-with-me', GroupController.getMyGroupFiles)
router.get('/:groupId', GroupController.getGroup)
router.put('/:groupId', GroupController.updateGroup)
router.delete('/:groupId', GroupController.deleteGroup)

// ── Members ───────────────────────────────────────────────────────────────────
router.post('/:groupId/members', GroupController.addMember)
router.get('/:groupId/members', GroupController.listMembers)
router.patch('/:groupId/members/:userId', GroupController.updateMemberRole)
router.delete('/:groupId/members/:userId', GroupController.removeMember)

// ── File Sharing ──────────────────────────────────────────────────────────────
router.post('/:groupId/files', GroupController.shareFile)
router.get('/:groupId/files', GroupController.listGroupFiles)
router.patch('/:groupId/files/:fileId', GroupController.updateFilePermission)
router.delete('/:groupId/files/:fileId', GroupController.removeFile)

export default router
