import { Request, Response, NextFunction } from "express";

const concurrentUploads = new Map<string, number>();

// #63 - Throttle concurrent uploads per user to prevent disk exhaustion
export const uploadThrottle = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    next();
    return;
  }
  
  const userId = req.user.id;
  const count = concurrentUploads.get(userId) ?? 0;
  
  // Limit to 3 concurrent uploads per user
  if (count >= 3) {
    res.status(429).json({ message: "Too many concurrent uploads. Please wait." });
    return;
  }
  
  concurrentUploads.set(userId, count + 1);
  
  res.on("finish", () => {
    const currentCount = concurrentUploads.get(userId) ?? 1;
    if (currentCount <= 1) {
      concurrentUploads.delete(userId);
    } else {
      concurrentUploads.set(userId, currentCount - 1);
    }
  });
  
  // Clean up if the connection is closed abruptly
  res.on("close", () => {
    if (!res.writableEnded) {
      const currentCount = concurrentUploads.get(userId) ?? 1;
      if (currentCount <= 1) {
        concurrentUploads.delete(userId);
      } else {
        concurrentUploads.set(userId, currentCount - 1);
      }
    }
  });
  
  next();
};
