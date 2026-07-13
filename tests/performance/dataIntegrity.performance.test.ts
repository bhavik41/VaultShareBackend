/**
 * Performance Testing — Data Integrity & Headers
 * Verifies that SHA-256 computation, presigned URL building, and header
 * operations stay within acceptable thresholds.
 */
import crypto from "crypto";

// ─── SHA-256 file hashing ──────────────────────────────────────────────────────

describe("Performance — SHA-256 file hashing", () => {
  it("hashes a 1 KB buffer in under 1ms", () => {
    const buf = Buffer.alloc(1024, "A");
    const start = Date.now();
    crypto.createHash("sha256").update(buf).digest("hex");
    expect(Date.now() - start).toBeLessThan(1);
  });

  it("hashes a 1 MB buffer in under 20ms", () => {
    const buf = Buffer.alloc(1024 * 1024, "B");
    const start = Date.now();
    crypto.createHash("sha256").update(buf).digest("hex");
    expect(Date.now() - start).toBeLessThan(20);
  });

  it("hashes a 10 MB buffer in under 100ms", () => {
    const buf = Buffer.alloc(10 * 1024 * 1024, "C");
    const start = Date.now();
    crypto.createHash("sha256").update(buf).digest("hex");
    expect(Date.now() - start).toBeLessThan(100);
  });

  it("hashes a 50 MB buffer (max upload) in under 500ms", () => {
    const buf = Buffer.alloc(50 * 1024 * 1024, "D");
    const start = Date.now();
    crypto.createHash("sha256").update(buf).digest("hex");
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("hash result is always exactly 64 hex characters", () => {
    for (const size of [0, 1, 512, 4096, 65536]) {
      const hash = crypto.createHash("sha256").update(Buffer.alloc(size, "x")).digest("hex");
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("1000 small-buffer hashes complete in under 50ms", () => {
    const buf = Buffer.from("small test file content");
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      crypto.createHash("sha256").update(buf).digest("hex");
    }
    expect(Date.now() - start).toBeLessThan(50);
  });
});

// ─── Hash uniqueness / collision resistance ────────────────────────────────────

describe("Performance — Hash uniqueness", () => {
  it("1000 hashes of unique inputs are all distinct", () => {
    const hashes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      hashes.add(crypto.createHash("sha256").update(`file_content_${i}`).digest("hex"));
    }
    expect(hashes.size).toBe(1000);
  });

  it("a 1-byte difference in input produces a completely different hash", () => {
    const buf1 = Buffer.from("hello vault share");
    const buf2 = Buffer.from("hello vault sharE");
    const h1 = crypto.createHash("sha256").update(buf1).digest("hex");
    const h2 = crypto.createHash("sha256").update(buf2).digest("hex");
    const matching = [...h1].filter((c, i) => c === h2[i]).length;
    expect(matching).toBeLessThan(32);
  });
});

// ─── X-Content-Hash header overhead ───────────────────────────────────────────

describe("Performance — X-Content-Hash header string operations", () => {
  it("10000 header validation checks (hex regex) complete in under 50ms", () => {
    const validHash = crypto.createHash("sha256").update("test").digest("hex");
    const hexRegex = /^[0-9a-f]{64}$/;
    const start = Date.now();
    for (let i = 0; i < 10_000; i++) {
      hexRegex.test(validHash);
    }
    expect(Date.now() - start).toBeLessThan(50);
  });
});

// ─── MIME type allowlist lookup ────────────────────────────────────────────────

describe("Performance — MIME type allowlist lookup", () => {
  it("10000 Set.has lookups complete in under 10ms", async () => {
    const { ALLOWED_MIME_TYPES } = await import("../../src/middleware/upload");
    const start = Date.now();
    for (let i = 0; i < 10_000; i++) {
      ALLOWED_MIME_TYPES.has("application/pdf");
    }
    expect(Date.now() - start).toBeLessThan(10);
  });
});
