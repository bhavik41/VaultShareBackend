import { Schema, model } from 'mongoose'

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
}

const fileSchema = new Schema<IFile>({
  _id: { type: String },
  userId: { type: String, required: true, index: true },
  originalName: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  diskPath: { type: String, required: true },
  publicUrl: { type: String, required: true },
  adminOnlyChat: { type: Boolean, default: false },
  createdAt: { type: Date, default: () => new Date() },
})

export const FileModel = model<IFile>('File', fileSchema)
