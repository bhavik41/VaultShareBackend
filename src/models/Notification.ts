import { Schema, model } from "mongoose";

export type NotificationType =
  | "version_request"
  | "version_approved"
  | "version_rejected";

export interface INotification {
  _id: string;
  userId: string; // recipient
  type: NotificationType;
  fileId: string;
  message: string;
  read: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>({
  _id: { type: String },
  userId: { type: String, required: true, index: true },
  type: {
    type: String,
    enum: ["version_request", "version_approved", "version_rejected"],
    required: true,
  },
  fileId: { type: String, required: true },
  message: { type: String, required: true },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: () => new Date(), index: true },
});

notificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

export const NotificationModel = model<INotification>("Notification", notificationSchema);
