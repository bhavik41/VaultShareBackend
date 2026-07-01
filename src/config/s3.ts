import { S3Client } from "@aws-sdk/client-s3";

export const S3_BUCKET = process.env.AWS_S3_BUCKET ?? "";
const region = process.env.AWS_REGION ?? "us-east-1";

// Credentials are picked up automatically from AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
// env vars, or from the EC2 instance role if none are set — no code change needed either way.
export const s3Client = new S3Client({ region });
