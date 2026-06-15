import Joi from "joi"
import { Request, Response, NextFunction } from "express"

export const validateAuditQuery = (req: Request, res: Response, next: NextFunction): void => {
  const schema = Joi.object({
    action: Joi.string().valid("upload", "download", "view", "share", "permission_change", "delete", "revoke_access", "star").optional(),
    limit: Joi.number().integer().min(1).max(100).optional(),
    offset: Joi.number().integer().min(0).optional(),
  })
  const { error } = schema.validate(req.query)
  if (error) {
    res.status(400).json({ message: error.message })
    return
  }
  next()
}

export const validateDateRangeQuery = (req: Request, res: Response, next: NextFunction): void => {
  const schema = Joi.object({
    from: Joi.string().isoDate().required(),
    to: Joi.string().isoDate().required(),
  })
  const { error } = schema.validate(req.query)
  if (error) {
    res.status(400).json({ message: error.message })
    return
  }
  next()
}
