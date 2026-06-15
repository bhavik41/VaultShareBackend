import { Schema, model } from 'mongoose'

export interface IFile {
  _id: string
  userId: string
  originalName: string
  mimeType: string
  size: number
  gcsBucket: string
  gcsKey: string
  publicUrl: string
  createdAt: Date
}

const fileSchema = new Schema<IFile>({
  _id: { type: String },
  userId: { type: String, required: true, index: true },
  originalName: { type: String, required: true },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  gcsBucket: { type: String, required: true },
  gcsKey: { type: String, required: true },
  publicUrl: { type: String, required: true },
  createdAt: { type: Date, default: () => new Date() },
})

export const FileModel = model<IFile>('File', fileSchema)
