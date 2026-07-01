/**
 * One-off migration: uploads every existing file's local-disk copy to S3 as
 * its v1/active FileVersion and points File.activeVersionId at it.
 *
 * Safe to re-run: files that already have an activeVersionId are skipped.
 * Local disk copies are left untouched (not deleted) so the migration is
 * reversible; pass --delete-local to remove them after a verified upload.
 *
 * Usage:
 *   npx ts-node scripts/migrate-files-to-s3.ts [--delete-local]
 */
import "dotenv/config";
import fs from "fs";
import mongoose from "mongoose";
import { connectDB } from "../src/db/mongoose";
import { getAllFiles } from "../src/db/fileStore";
import { getActiveVersion, createFileVersion, setActiveVersion } from "../src/db/fileVersionStore";
import * as s3Service from "../src/services/s3.service";

const deleteLocal = process.argv.includes("--delete-local");

async function migrate() {
  await connectDB();

  const files = await getAllFiles();
  console.log(`Found ${files.length} file record(s).`);

  let migrated = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of files) {
    const existingActive = await getActiveVersion(file.id);
    if (existingActive) {
      skipped++;
      continue;
    }

    if (!file.diskPath || !fs.existsSync(file.diskPath)) {
      console.warn(`  [skip] ${file.id} (${file.originalName}) has no disk copy — nothing to migrate.`);
      skipped++;
      continue;
    }

    try {
      const buffer = fs.readFileSync(file.diskPath);
      const s3Key = s3Service.buildVersionKey(file.userId, file.id, 1, file.originalName);
      await s3Service.putObject(s3Key, buffer, file.mimeType);

      const version = await createFileVersion({
        fileId: file.id,
        versionNumber: 1,
        uploadedBy: file.userId,
        s3Key,
        size: file.size,
        mimeType: file.mimeType,
        isEncrypted: file.isEncrypted,
      });
      await setActiveVersion(file.id, version.id);

      if (deleteLocal) {
        fs.unlinkSync(file.diskPath);
      }

      migrated++;
      console.log(`  [ok]   ${file.id} (${file.originalName}) -> ${s3Key}`);
    } catch (err: any) {
      failed++;
      console.error(`  [fail] ${file.id} (${file.originalName}): ${err.message}`);
    }
  }

  console.log(`\nDone. migrated=${migrated} skipped=${skipped} failed=${failed}`);
  await mongoose.disconnect();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
