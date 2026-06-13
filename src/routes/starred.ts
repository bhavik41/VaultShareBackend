import { Router, Request, Response } from 'express'
import { authenticate } from '../middleware/auth'
import { starFile, unstarFile, getStarredFileIds } from '../db/starredStore'
import { requireFileAccess } from '../utils/accessControl'

const router = Router()

router.use(authenticate)

// GET /api/starred — list starred file IDs for the current user
router.get('/', async (req: Request, res: Response): Promise<void> => {
  try {
    const ids = await getStarredFileIds(req.user!.id)
    res.json({ starredFileIds: ids })
  } catch (err: any) {
    res.status(500).json({ message: err.message })
  }
})

// POST /api/starred/:fileId — star a file
router.post('/:fileId', async (req: Request, res: Response): Promise<void> => {
  try {
    await requireFileAccess(req.params.fileId, req.user!.id, 'view')
    await starFile(req.user!.id, req.params.fileId)
    res.json({ message: 'File starred.' })
  } catch (err: any) {
    const status = err.message === 'Access denied.' ? 403 : err.message.includes('not found') ? 404 : 500
    res.status(status).json({ message: err.message })
  }
})

// DELETE /api/starred/:fileId — unstar a file
router.delete('/:fileId', async (req: Request, res: Response): Promise<void> => {
  try {
    await unstarFile(req.user!.id, req.params.fileId)
    res.json({ message: 'File unstarred.' })
  } catch (err: any) {
    res.status(500).json({ message: err.message })
  }
})

export default router
