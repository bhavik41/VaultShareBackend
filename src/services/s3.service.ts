import path from "path";
import { v4 as uuidv4 } from "uuid";
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "stream";
import { s3Client, S3_BUCKET } from "../config/s3";

export function buildVersionKey(
  userId: string,
  fileId: string,
  versionNumber: number,
  originalName: string,
): string {
  const ext = path.extname(originalName);
  return `uploads/${userId}/${fileId}/v${versionNumber}_${uuidv4()}${ext}`;
}

export function buildStagingKey(fileId: string, originalName: string): string {
  const ext = path.extname(originalName);
  return `staging/${fileId}/pending_${uuidv4()}${ext}`;
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

export async function getObjectStream(key: string): Promise<Readable> {
  const result = await s3Client.send(
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: key }),
  );
  return result.Body as Readable;
}

export async function deleteObject(key: string): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

/**
 * Used when an admin approves a staged version-upload request: moves the
 * object from its staging key to its permanent versioned key.
 */
export async function moveObject(sourceKey: string, destKey: string): Promise<void> {
  await s3Client.send(
    new CopyObjectCommand({
      Bucket: S3_BUCKET,
      CopySource: `${S3_BUCKET}/${sourceKey.split("/").map(encodeURIComponent).join("/")}`,
      Key: destKey,
    }),
  );
  await deleteObject(sourceKey);
}

/**
 * Presigned GET, kept for callers that want a client-redirected download
 * instead of a server-proxied stream. Not used by the default download
 * path (which streams via getObjectStream to preserve RBAC-at-request-time
 * and the existing client-side decrypt flow without needing bucket CORS).
 */
export async function getPresignedDownloadUrl(
  key: string,
  expiresInSeconds = 300,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: key });
  return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
}
