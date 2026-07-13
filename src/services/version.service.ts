import crypto from "crypto";
import * as s3Service from "./s3.service";
import * as auditService from "./audit.service";
import { MAX_USER_STORAGE_BYTES } from "./file.service";
import {
  getFileById,
  getFilesByUser,
  updateVersionPolicy as updateVersionPolicyInStore,
  updateFileVersionSummary,
} from "../db/fileStore";
import {
  createFileVersion,
  getVersionsByFile,
  getVersionById,
  getActiveVersion,
  getNextVersionNumber,
  setActiveVersion as setActiveVersionInStore,
  deleteFileVersion,
  StoredFileVersion,
} from "../db/fileVersionStore";
import {
  createVersionRequest,
  getVersionRequestById,
  getPendingRequestsByFile,
  getPendingRequestsForFiles,
  getUserPendingRequest,
  getUserRecentRequest,
  getUserRejectedRequests,
  updateVersionRequestStatus,
  StoredVersionRequest,
} from "../db/versionRequestStore";
import { createNotification } from "../db/notificationStore";
import { findUserById } from "../db/inMemoryStore";
import {
  getFilePermission,
  requireFileAccess,
  getVersionUploadDecision,
} from "../utils/accessControl";
import { VersionPolicy } from "../models/File";
import {
  sendVersionRequestEmail,
  sendVersionApprovedEmail,
  sendVersionRejectedEmail,
} from "../utils/email";

async function assertUnderQuota(ownerId: string, incomingSize: number): Promise<void> {
  const existingFiles = await getFilesByUser(ownerId);
  const totalBytes = existingFiles.reduce((acc, f) => acc + f.size, 0);
  if (totalBytes + incomingSize > MAX_USER_STORAGE_BYTES) {
    throw new Error("Storage quota exceeded (1GB limit).");
  }
}

export async function listVersions(
  fileId: string,
  userId: string,
): Promise<StoredFileVersion[]> {
  await requireFileAccess(fileId, userId, "view");
  return getVersionsByFile(fileId);
}

export async function uploadVersionDirect(
  fileId: string,
  userId: string,
  multerFile: Express.Multer.File,
  options: { changeNote?: string; isEncrypted?: boolean },
): Promise<StoredFileVersion> {
  const permission = await getFilePermission(fileId, userId);
  if (!permission) throw new Error("Access denied.");
  const { file } = permission;

  const decision = getVersionUploadDecision(file.versionPolicy, permission.role);
  if (decision !== "direct") throw new Error("Access denied.");

  await assertUnderQuota(file.userId, multerFile.size);

  const versionNumber = await getNextVersionNumber(fileId);
  const isEncrypted = options.isEncrypted ?? false;
  const sha256 = crypto.createHash("sha256").update(multerFile.buffer).digest("hex");
  const s3Key = s3Service.buildVersionKey(file.userId, fileId, versionNumber, multerFile.originalname);
  await s3Service.putObject(s3Key, multerFile.buffer, multerFile.mimetype);

  const version = await createFileVersion({
    fileId,
    versionNumber,
    uploadedBy: userId,
    s3Key,
    originalName: multerFile.originalname,
    size: multerFile.size,
    mimeType: multerFile.mimetype,
    changeNote: options.changeNote,
    isEncrypted,
    sha256,
  });

  auditService.logAction(
    fileId,
    userId,
    "version_upload",
    `Uploaded version ${versionNumber} of ${file.originalName}`,
  );

  return version;
}

export async function requestVersionUpload(
  fileId: string,
  userId: string,
  multerFile: Express.Multer.File,
  options: { changeNote?: string; isEncrypted?: boolean },
): Promise<StoredVersionRequest> {
  const permission = await getFilePermission(fileId, userId);
  if (!permission) throw new Error("Access denied.");
  const { file } = permission;

  const decision = getVersionUploadDecision(file.versionPolicy, permission.role);
  if (decision !== "request") throw new Error("Access denied.");

  const stagingKey = s3Service.buildStagingKey(fileId, multerFile.originalname);
  await s3Service.putObject(stagingKey, multerFile.buffer, multerFile.mimetype);
  const sha256 = crypto.createHash("sha256").update(multerFile.buffer).digest("hex");

  const request = await createVersionRequest({
    fileId,
    requestedBy: userId,
    stagingS3Key: stagingKey,
    size: multerFile.size,
    mimeType: multerFile.mimetype,
    isEncrypted: options.isEncrypted ?? false,
    originalName: multerFile.originalname,
    changeNote: options.changeNote,
    sha256,
  });

  auditService.logAction(
    fileId,
    userId,
    "version_request",
    `Requested a version upload for ${file.originalName}`,
  );

  const requester = await findUserById(userId);
  const message = `${requester?.name ?? "A collaborator"} requested to upload a new version of "${file.originalName}".`;
  await createNotification({ userId: file.userId, type: "version_request", fileId, message });

  const owner = await findUserById(file.userId);
  if (owner) {
    sendVersionRequestEmail(owner.email, file.originalName, requester?.name ?? "A collaborator").catch(() => {});
  }

  return request;
}

export async function listPendingRequests(
  fileId: string,
  userId: string,
): Promise<StoredVersionRequest[]> {
  await requireFileAccess(fileId, userId, "owner");
  return getPendingRequestsByFile(fileId);
}

export async function getMyPendingRequest(
  fileId: string,
  userId: string,
): Promise<StoredVersionRequest | null> {
  await requireFileAccess(fileId, userId, "view");
  return (await getUserRecentRequest(fileId, userId)) ?? null;
}

export async function getMyRejectedRequests(
  fileId: string,
  userId: string,
): Promise<StoredVersionRequest[]> {
  await requireFileAccess(fileId, userId, "view");
  return getUserRejectedRequests(fileId, userId);
}

/**
 * Pending version requests across every file the given user owns — backs
 * the admin approval queue on the dashboard.
 */
export async function listPendingRequestsForOwner(
  ownerId: string,
): Promise<StoredVersionRequest[]> {
  const files = await getFilesByUser(ownerId);
  if (files.length === 0) return [];
  return getPendingRequestsForFiles(files.map((f) => f.id));
}

export async function approveVersionRequest(
  fileId: string,
  requestId: string,
  adminUserId: string,
): Promise<StoredFileVersion> {
  const { file } = await requireFileAccess(fileId, adminUserId, "owner");

  const request = await getVersionRequestById(requestId);
  if (!request || request.fileId !== fileId) throw new Error("Version request not found.");
  if (request.status !== "pending") throw new Error("Version request has already been reviewed.");

  const versionNumber = await getNextVersionNumber(fileId);
  const finalKey = s3Service.buildVersionKey(file.userId, fileId, versionNumber, request.originalName);
  await s3Service.moveObject(request.stagingS3Key, finalKey);

  const version = await createFileVersion({
    fileId,
    versionNumber,
    uploadedBy: request.requestedBy,
    s3Key: finalKey,
    originalName: request.originalName,
    size: request.size,
    mimeType: request.mimeType,
    changeNote: request.changeNote,
    isEncrypted: request.isEncrypted,
    sha256: request.sha256,
  });

  await updateVersionRequestStatus(requestId, "approved", adminUserId);

  auditService.logAction(
    fileId,
    adminUserId,
    "version_approved",
    `Approved version request; added as version ${versionNumber} of ${file.originalName}`,
  );

  const requester = await findUserById(request.requestedBy);
  await createNotification({
    userId: request.requestedBy,
    type: "version_approved",
    fileId,
    message: `Your version upload for "${file.originalName}" was approved as v${versionNumber}.`,
  });
  if (requester) {
    sendVersionApprovedEmail(requester.email, file.originalName, versionNumber).catch(() => {});
  }

  return version;
}

export async function rejectVersionRequest(
  fileId: string,
  requestId: string,
  adminUserId: string,
): Promise<StoredVersionRequest> {
  const { file } = await requireFileAccess(fileId, adminUserId, "owner");

  const request = await getVersionRequestById(requestId);
  if (!request || request.fileId !== fileId) throw new Error("Version request not found.");
  if (request.status !== "pending") throw new Error("Version request has already been reviewed.");

  await s3Service.deleteObject(request.stagingS3Key).catch(() => {});
  const updated = await updateVersionRequestStatus(requestId, "rejected", adminUserId);

  auditService.logAction(
    fileId,
    adminUserId,
    "version_rejected",
    `Rejected version request for ${file.originalName}`,
  );

  const requester = await findUserById(request.requestedBy);
  await createNotification({
    userId: request.requestedBy,
    type: "version_rejected",
    fileId,
    message: `Your version upload for "${file.originalName}" was rejected.`,
  });
  if (requester) {
    sendVersionRejectedEmail(requester.email, file.originalName).catch(() => {});
  }

  return updated!;
}

export async function activateVersion(
  fileId: string,
  versionId: string,
  adminUserId: string,
): Promise<StoredFileVersion> {
  const { file } = await requireFileAccess(fileId, adminUserId, "owner");

  const version = await getVersionById(versionId);
  if (!version || version.fileId !== fileId) throw new Error("Version not found.");

  const updated = await setActiveVersionInStore(fileId, versionId);
  await updateFileVersionSummary(fileId, {
    size: updated.size,
    mimeType: updated.mimeType,
    isEncrypted: updated.isEncrypted,
  });

  auditService.logAction(
    fileId,
    adminUserId,
    "version_activated",
    `Set version ${updated.versionNumber} as the active version of ${file.originalName}`,
  );

  return updated;
}

export async function downloadVersion(
  fileId: string,
  versionId: string,
  userId: string,
): Promise<{ stream: Awaited<ReturnType<typeof s3Service.getObjectStream>>; version: StoredFileVersion; fileName: string }> {
  const { file } = await requireFileAccess(fileId, userId, "download");

  const version = await getVersionById(versionId);
  if (!version || version.fileId !== fileId) throw new Error("Version not found.");

  const stream = await s3Service.getObjectStream(version.s3Key);

  auditService.logAction(
    fileId,
    userId,
    "download",
    `Downloaded version ${version.versionNumber} of ${file.originalName}`,
  );

  return { stream, version, fileName: file.originalName };
}

export async function deleteVersion(
  fileId: string,
  versionId: string,
  adminUserId: string,
): Promise<void> {
  const { file } = await requireFileAccess(fileId, adminUserId, "owner");

  const version = await getVersionById(versionId);
  if (!version || version.fileId !== fileId) throw new Error("Version not found.");
  if (version.isActive) {
    throw new Error("Cannot delete the active version. Promote another version first.");
  }

  await s3Service.deleteObject(version.s3Key);
  await deleteFileVersion(versionId);

  auditService.logAction(
    fileId,
    adminUserId,
    "version_deleted",
    `Deleted version ${version.versionNumber} of ${file.originalName}`,
  );
}

const VALID_POLICIES: VersionPolicy[] = ["admin_only", "role_gated", "open"];

export async function updateVersionPolicy(
  fileId: string,
  ownerUserId: string,
  policy: string,
): Promise<VersionPolicy> {
  const { file } = await requireFileAccess(fileId, ownerUserId, "owner");
  if (!VALID_POLICIES.includes(policy as VersionPolicy)) {
    throw new Error("Invalid version policy.");
  }

  await updateVersionPolicyInStore(fileId, policy as VersionPolicy);

  auditService.logAction(
    fileId,
    ownerUserId,
    "permission_change",
    `Changed version upload policy of ${file.originalName} to "${policy}"`,
  );

  return policy as VersionPolicy;
}

export { getActiveVersion };
