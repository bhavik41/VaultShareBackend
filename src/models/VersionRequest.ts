import { Schema, model } from "mongoose";

export type VersionRequestStatus = "pending" | "approved" | "rejected";

export interface IVersionRequest {
  _id: string;
  fileId: string;
  requestedBy: string;
  stagingS3Key: string;
  size: number;
  mimeType: string;
  isEncrypted: boolean;
  originalName: string;
  changeNote?: string;
  status: VersionRequestStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

const versionRequestSchema = new Schema<IVersionRequest>({
  _id: { type: String },
  fileId: { type: String, required: true, index: true },
  requestedBy: { type: String, required: true },
  stagingS3Key: { type: String, required: true },
  size: { type: Number, required: true },
  mimeType: { type: String, required: true },
  isEncrypted: { type: Boolean, default: false },
  originalName: { type: String, required: true },
  changeNote: { type: String },
  status: {
    type: String,
    enum: ["pending", "approved", "rejected"],
    default: "pending",
  },
  reviewedBy: { type: String, default: null },
  reviewedAt: { type: Date, default: null },
  createdAt: { type: Date, default: () => new Date() },
});

versionRequestSchema.index({ fileId: 1, status: 1 });
versionRequestSchema.index({ requestedBy: 1, status: 1 });

export const VersionRequestModel = model<IVersionRequest>(
  "VersionRequest",
  versionRequestSchema,
);
