import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import * as collaborationService from "../services/collaboration.service";
import { UserPayload } from "../types";

type ShareLinkValidation = Awaited<
  ReturnType<typeof collaborationService.validateShareLinkToken>
>;

declare global {
  namespace Express {
    interface Request {
      shareLinkValidation?: ShareLinkValidation;
    }
  }
}

function getBearerUser(req: Request): UserPayload | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;

  try {
    return jwt.verify(
      authHeader.split(" ")[1],
      process.env.JWT_SECRET as string,
    ) as UserPayload;
  } catch {
    return null;
  }
}

export async function validateShareLink(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    req.shareLinkValidation =
      await collaborationService.validateShareLinkToken(req.params.token);
    next();
  } catch (error: any) {
    const status =
      error.message === "Share link not found." || error.message === "File not found."
        ? 404
        : error.message.includes("expired") || error.message.includes("revoked")
          ? 410
          : 400;
    res.status(status).json({ message: error.message });
  }
}

export function requireShareLinkDownloadPermission(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const validation = req.shareLinkValidation;
  if (!validation) {
    res.status(500).json({ message: "Share link validation missing." });
    return;
  }

  const { shareLink } = validation;

  if (shareLink.permissionMode === "download") {
    next();
    return;
  }

  if (shareLink.permissionMode === "admin-download") {
    const user = getBearerUser(req);
    if (!user) {
      res.status(401).json({ message: "Authentication required." });
      return;
    }

    if (user.id !== shareLink.ownerId) {
      res.status(403).json({ message: "Only the file owner may download using this link." });
      return;
    }

    req.user = user;
    next();
    return;
  }

  res.status(403).json({ message: "Download is not allowed for this share link." });
}
