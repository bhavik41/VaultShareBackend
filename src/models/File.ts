import { Schema, model } from 'mongoose'

export type VersionPolicy = 'admin_only' | 'role_gated' | 'open'

export interface IFile {
  _id: string
  userId: string
  originalName: string
  mimeType: string
  size: number
  diskPath: string
  publicUrl: string
  adminOnlyChat: boolean
  createdAt: Date
  isEncrypted: boolean
  versionPolicy: VersionPolicy
  activeVersionId: string | null
}

const fileSchema = new Schema<IFile>({
  _id: { type: String },
  userId: { type: String, required: true, index: true },
  originalName: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  // Legacy field for files uploaded before the S3 migration; new files store
  // their bytes via FileVersion.s3Key instead and leave this empty.
  diskPath: { type: String, required: false, default: '' },
  publicUrl: { type: String, required: true },
  adminOnlyChat: { type: Boolean, default: false },
  createdAt: { type: Date, default: () => new Date() },
  isEncrypted: { type: Boolean, default: false },
  versionPolicy: {
    type: String,
    enum: ['admin_only', 'role_gated', 'open'],
    default: 'admin_only',
  },
  activeVersionId: { type: String, default: null },
})

export const FileModel = model<IFile>('File', fileSchema)
