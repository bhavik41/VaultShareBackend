import { Request, Response, NextFunction } from "express"
import { AuditAction } from "../db/auditStore"

const AUDIT_ACTIONS: AuditAction[] = [
  "upload",
  "download",
  "view",
  "share",
  "permission_change",
  "delete",
  "revoke_access",
  "star",
  "invitation_accepted",
]

function firstQueryValue(value: unknown): string | undefined {
  if (Array.isArray(value)) return String(value[0])
  if (typeof value === "string") return value
  return undefined
}

function parseBoundedInteger(
  value: unknown,
  field: string,
  min: number,
  max?: number,
): string | null {
  const raw = firstQueryValue(value)
  if (raw === undefined) return null

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed < min || (max !== undefined && parsed > max)) {
    return `${field} must be an integer between ${min} and ${max ?? "unlimited"}.`
  }

  return null
}

export const validateAuditQuery = (req: Request, res: Response, next: NextFunction): void => {
  const action = firstQueryValue(req.query.action)
  if (action && !AUDIT_ACTIONS.includes(action as AuditAction)) {
    res.status(400).json({ message: "action is not a valid audit action." })
    return
  }

  const limitError = parseBoundedInteger(req.query.limit, "limit", 1, 100)
  const offsetError = parseBoundedInteger(req.query.offset, "offset", 0)
  if (limitError || offsetError) {
    res.status(400).json({ message: limitError ?? offsetError })
    return
  }

  next()
}

export const validateDateRangeQuery = (req: Request, res: Response, next: NextFunction): void => {
  const from = firstQueryValue(req.query.from)
  const to = firstQueryValue(req.query.to)
  if (!from || !to) {
    res.status(400).json({ message: "from and to query params are required." })
    return
  }

  if (Number.isNaN(new Date(from).getTime()) || Number.isNaN(new Date(to).getTime())) {
    res.status(400).json({ message: "from and to must be valid ISO date strings." })
    return
  }

  next()
}
