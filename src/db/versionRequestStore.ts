import { v4 as uuidv4 } from "uuid";
import { VersionRequestModel, IVersionRequest, VersionRequestStatus } from "../models/VersionRequest";

export interface StoredVersionRequest {
  id: string;
  fileId: string;
  requestedBy: string;
  stagingS3Key: string;
  size: number;
  mimeType: string;
  isEncrypted: boolean;
  originalName: string;
  changeNote?: string;
  sha256?: string;
  status: VersionRequestStatus;
  reviewedBy: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
}

function toStored(doc: IVersionRequest): StoredVersionRequest {
  return {
    id: doc._id,
    fileId: doc.fileId,
    requestedBy: doc.requestedBy,
    stagingS3Key: doc.stagingS3Key,
    size: doc.size,
    mimeType: doc.mimeType,
    isEncrypted: doc.isEncrypted,
    originalName: doc.originalName,
    changeNote: doc.changeNote,
    sha256: doc.sha256,
    status: doc.status,
    reviewedBy: doc.reviewedBy,
    reviewedAt: doc.reviewedAt,
    createdAt: doc.createdAt,
  };
}

export async function createVersionRequest(input: {
  fileId: string;
  requestedBy: string;
  stagingS3Key: string;
  size: number;
  mimeType: string;
  isEncrypted: boolean;
  originalName: string;
  changeNote?: string;
  sha256?: string;
}): Promise<StoredVersionRequest> {
  const doc = await VersionRequestModel.create({
    _id: uuidv4(),
    ...input,
    status: "pending",
    reviewedBy: null,
    reviewedAt: null,
  });
  return toStored(doc.toObject());
}

export async function getVersionRequestById(id: string): Promise<StoredVersionRequest | undefined> {
  const doc = await VersionRequestModel.findById(id).lean();
  return doc ? toStored(doc) : undefined;
}

export async function getUserPendingRequest(
  fileId: string,
  requestedBy: string,
): Promise<StoredVersionRequest | undefined> {
  const doc = await VersionRequestModel.findOne({ fileId, requestedBy, status: "pending" }).lean();
  return doc ? toStored(doc) : undefined;
}

export async function getUserRecentRequest(
  fileId: string,
  requestedBy: string,
): Promise<StoredVersionRequest | undefined> {
  const doc = await VersionRequestModel.findOne(
    { fileId, requestedBy, status: { $in: ["pending", "rejected"] } },
    null,
    { sort: { createdAt: -1 } },
  ).lean();
  return doc ? toStored(doc) : undefined;
}

export async function getUserRejectedRequests(
  fileId: string,
  requestedBy: string,
): Promise<StoredVersionRequest[]> {
  const docs = await VersionRequestModel.find(
    { fileId, requestedBy, status: "rejected" },
    null,
    { sort: { createdAt: -1 } },
  ).lean();
  return docs.map(toStored);
}

export async function getPendingRequestsByFile(fileId: string): Promise<StoredVersionRequest[]> {
  const docs = await VersionRequestModel.find({ fileId, status: "pending" })
    .sort({ createdAt: -1 })
    .lean();
  return docs.map(toStored);
}

export async function getPendingRequestsForFiles(fileIds: string[]): Promise<StoredVersionRequest[]> {
  const docs = await VersionRequestModel.find({ fileId: { $in: fileIds }, status: "pending" })
    .sort({ createdAt: -1 })
    .lean();
  return docs.map(toStored);
}

export async function updateVersionRequestStatus(
  id: string,
  status: VersionRequestStatus,
  reviewedBy: string,
): Promise<StoredVersionRequest | undefined> {
  const doc = await VersionRequestModel.findByIdAndUpdate(
    id,
    { status, reviewedBy, reviewedAt: new Date() },
    { new: true },
  ).lean();
  return doc ? toStored(doc) : undefined;
}
