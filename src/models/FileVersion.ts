import { Schema, model } from "mongoose";

export interface IFileVersion {
  _id: string;
  fileId: string;
  versionNumber: number;
  uploadedBy: string;
  s3Key: string;
  originalName: string;
  size: number;
  mimeType: string;
  changeNote?: string;
  isActive: boolean;
  isEncrypted: boolean;
  createdAt: Date;
}

const fileVersionSchema = new Schema<IFileVersion>({
  _id: { type: String },
  fileId: { type: String, required: true, index: true },
  versionNumber: { type: Number, required: true },
  uploadedBy: { type: String, required: true },
  s3Key: { type: String, required: true },
  originalName: { type: String, default: "" },
  size: { type: Number, required: true },
  mimeType: { type: String, required: true },
  changeNote: { type: String },
  isActive: { type: Boolean, default: false },
  isEncrypted: { type: Boolean, default: false },
  createdAt: { type: Date, default: () => new Date() },
});

fileVersionSchema.index({ fileId: 1, versionNumber: 1 }, { unique: true });
fileVersionSchema.index({ fileId: 1, isActive: 1 });

export const FileVersionModel = model<IFileVersion>("FileVersion", fileVersionSchema);
