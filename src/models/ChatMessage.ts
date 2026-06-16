import { Schema, model } from 'mongoose'

export interface IChatMessage {
  _id: string
  fileId: string
  userId: string
  userName: string
  userEmail: string
  content: string
  timestamp: Date
}

const chatMessageSchema = new Schema<IChatMessage>({
  _id: { type: String },
  fileId: { type: String, required: true, index: true },
  userId: { type: String, required: true },
  userName: { type: String, required: true },
  userEmail: { type: String, required: true, default: '' },
  content: { type: String, required: true },
  timestamp: { type: Date, default: () => new Date() },
})

chatMessageSchema.index({ fileId: 1, timestamp: 1 })

export const ChatMessageModel = model<IChatMessage>('ChatMessage', chatMessageSchema)
