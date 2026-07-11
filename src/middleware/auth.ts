import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { UserPayload } from "../types/index";

// Extend Express Request to carry decoded user
declare global {
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ message: "Unauthorized: No token provided" });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const secret = process.env.JWT_SECRET as string;
    // Fix #5 — constrain to HS256 to prevent alg:none and RS/ES key-confusion attacks
    const decoded = jwt.verify(token, secret, { algorithms: ["HS256"] }) as UserPayload;
    req.user = decoded;
    next();
  } catch {
    res.status(401).json({ message: "Unauthorized: Invalid or expired token" });
  }
};
