import { Request, Response, NextFunction } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import fs from "fs";

const execAsync = promisify(exec);

/**
 * Scans the uploaded file with ClamAV clamscan.
 *
 * Requires ENABLE_VIRUS_SCAN=true in the environment to activate.
 * When enabled and ClamAV is unavailable:
 *   - Default: log a warning and allow the upload through (fail open)
 *   - With VIRUS_SCAN_STRICT=true: reject the upload (fail closed)
 *
 * Exit codes from clamscan:
 *   0 = clean, 1 = virus found, 2 = error
 */
export async function virusScan(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  if (process.env.ENABLE_VIRUS_SCAN !== "true") {
    next();
    return;
  }

  const file = req.file;
  if (!file) {
    next();
    return;
  }

  try {
    await execAsync(`clamscan --no-summary "${file.path}"`);
    // exit 0 → clean
    next();
  } catch (err: any) {
    if (err.code === 1) {
      // exit 1 → virus detected
      fs.unlink(file.path, () => {});
      res.status(422).json({ message: "Malware detected. Upload rejected." });
      return;
    }

    // exit 2 or ENOENT → ClamAV unavailable or scan error
    console.warn("[virus-scan] ClamAV unavailable or scan error:", err.message);

    if (process.env.VIRUS_SCAN_STRICT === "true") {
      fs.unlink(file.path, () => {});
      res.status(503).json({ message: "Virus scanner unavailable. Upload rejected." });
      return;
    }

    // Fail open: log the warning and proceed
    next();
  }
}
