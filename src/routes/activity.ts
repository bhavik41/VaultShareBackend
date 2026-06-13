import { Router } from 'express'
import { AuditController } from '../controllers/audit.controller'
import { authenticate } from '../middleware/auth'

const router = Router()

router.get('/my-activity', authenticate, AuditController.getMyActivity)

export default router
