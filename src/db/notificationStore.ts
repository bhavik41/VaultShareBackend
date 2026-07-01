import { v4 as uuidv4 } from "uuid";
import { NotificationModel, INotification, NotificationType } from "../models/Notification";

export interface StoredNotification {
  id: string;
  userId: string;
  type: NotificationType;
  fileId: string;
  message: string;
  read: boolean;
  createdAt: Date;
}

function toStored(doc: INotification): StoredNotification {
  return {
    id: doc._id,
    userId: doc.userId,
    type: doc.type,
    fileId: doc.fileId,
    message: doc.message,
    read: doc.read,
    createdAt: doc.createdAt,
  };
}

export async function createNotification(input: {
  userId: string;
  type: NotificationType;
  fileId: string;
  message: string;
}): Promise<StoredNotification> {
  const doc = await NotificationModel.create({ _id: uuidv4(), ...input, read: false });
  return toStored(doc.toObject());
}

export async function getNotificationsByUser(
  userId: string,
  opts?: { limit?: number },
): Promise<StoredNotification[]> {
  const docs = await NotificationModel.find({ userId })
    .sort({ createdAt: -1 })
    .limit(opts?.limit ?? 50)
    .lean();
  return docs.map(toStored);
}

export async function markNotificationRead(
  id: string,
  userId: string,
): Promise<StoredNotification | undefined> {
  const doc = await NotificationModel.findOneAndUpdate(
    { _id: id, userId },
    { read: true },
    { new: true },
  ).lean();
  return doc ? toStored(doc) : undefined;
}
