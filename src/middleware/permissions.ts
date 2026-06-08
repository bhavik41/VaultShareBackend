import { Request, Response, NextFunction } from "express";
import {
  FileAccessAction,
  FilePermission,
  requireFileAccess,
} from "../utils/accessControl";

declare global {
  namespace Express {
    interface Request {
      filePermission?: FilePermission;
    }
  }
}

export const requirePermission =
  (action: FileAccessAction = "view") =>
  (req: Request, res: Response, next: NextFunction): void => {
    const userId = req.user?.id;
    const fileId = req.params.fileId ?? req.params.id;

    if (!userId) {
      res.status(401).json({ message: "Unauthorized." });
      return;
    }

    if (!fileId) {
      res.status(400).json({ message: "File id is required." });
      return;
    }

    try {
      req.filePermission = requireFileAccess(fileId, userId, action);
      next();
    } catch (error: any) {
      const status = error.message === "File not found." ? 404 : 403;
      res.status(status).json({ message: error.message });
    }
  };