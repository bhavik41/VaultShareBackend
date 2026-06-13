import { v4 as uuidv4 } from 'uuid'
import { StarredModel } from '../models/Starred'

export const starFile = async (userId: string, fileId: string): Promise<void> => {
  await StarredModel.findOneAndUpdate(
    { userId, fileId },
    { $setOnInsert: { _id: uuidv4(), userId, fileId, createdAt: new Date() } },
    { upsert: true, new: true },
  )
}

export const unstarFile = async (userId: string, fileId: string): Promise<void> => {
  await StarredModel.deleteOne({ userId, fileId })
}

export const getStarredFileIds = async (userId: string): Promise<string[]> => {
  const docs = await StarredModel.find({ userId }).sort({ createdAt: -1 })
  return docs.map((d) => d.fileId)
}

export const isFileStarred = async (userId: string, fileId: string): Promise<boolean> => {
  const doc = await StarredModel.findOne({ userId, fileId })
  return doc !== null
}
