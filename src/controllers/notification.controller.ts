import { Request, Response } from "express";
import * as notificationStore from "../db/notificationStore";

export class NotificationController {
  static async list(req: Request, res: Response): Promise<void> {
    try {
      const notifications = await notificationStore.getNotificationsByUser(req.user!.id);
      res.status(200).json({ notifications });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }

  static async markRead(req: Request, res: Response): Promise<void> {
    try {
      const notification = await notificationStore.markNotificationRead(
        req.params.notificationId,
        req.user!.id,
      );
      if (!notification) {
        res.status(404).json({ message: "Notification not found." });
        return;
      }
      res.status(200).json({ notification });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  }
}
