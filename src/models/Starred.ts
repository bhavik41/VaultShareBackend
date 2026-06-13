import { Schema, model } from 'mongoose'

export interface IStarred {
  _id: string
  userId: string
  fileId: string
  createdAt: Date
}

const starredSchema = new Schema<IStarred>({
  _id: { type: String },
  userId: { type: String, required: true },
  fileId: { type: String, required: true },
  createdAt: { type: Date, default: () => new Date() },
})

starredSchema.index({ userId: 1, fileId: 1 }, { unique: true })
starredSchema.index({ userId: 1 })

export const StarredModel = model<IStarred>('Starred', starredSchema)
