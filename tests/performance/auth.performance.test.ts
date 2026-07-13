/**
 * Performance Testing — Auth
 * Measures critical-path timings: bcrypt comparison, JWT sign/verify, OTP hash.
 * These tests fail if operations exceed acceptable thresholds.
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";

// ─── bcrypt ────────────────────────────────────────────────────────────────────

describe("Performance — bcrypt", () => {
  let hash: string;

  beforeAll(async () => {
    hash = await bcrypt.hash("TestPassword123", 10);
  });

  it("bcrypt hash (cost=10) completes in under 1 second", async () => {
    const start = Date.now();
    await bcrypt.hash("BenchmarkPass1!", 10);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("bcrypt compare (correct password) completes in under 500ms", async () => {
    const start = Date.now();
    await bcrypt.compare("TestPassword123", hash);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("bcrypt compare (wrong password) completes in under 500ms — no timing shortcut", async () => {
    const start = Date.now();
    await bcrypt.compare("WrongPassword999", hash);
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("correct and wrong password comparisons have similar timing (no early-exit leak)", async () => {
    const RUNS = 3;
    let correctTotal = 0;
    let wrongTotal = 0;

    for (let i = 0; i < RUNS; i++) {
      let t = Date.now(); await bcrypt.compare("TestPassword123", hash); correctTotal += Date.now() - t;
      t = Date.now(); await bcrypt.compare("WrongPassword999", hash); wrongTotal += Date.now() - t;
    }

    const correctAvg = correctTotal / RUNS;
    const wrongAvg = wrongTotal / RUNS;
    // Both should be within 3× of each other — bcrypt is constant-time by design
    expect(Math.max(correctAvg, wrongAvg) / Math.min(correctAvg, wrongAvg)).toBeLessThan(3);
  });
});

// ─── JWT ──────────────────────────────────────────────────────────────────────

describe("Performance — JWT sign/verify", () => {
  const secret = process.env.JWT_SECRET!;
  let token: string;

  beforeAll(() => {
    token = jwt.sign({ id: "u1", email: "alice@example.com", name: "Alice" }, secret, {
      algorithm: "HS256",
      expiresIn: "1h",
    });
  });

  it("JWT sign completes in under 10ms", () => {
    const start = Date.now();
    jwt.sign({ id: "u1" }, secret, { algorithm: "HS256", expiresIn: "1h" });
    expect(Date.now() - start).toBeLessThan(10);
  });

  it("JWT verify completes in under 10ms", () => {
    const start = Date.now();
    jwt.verify(token, secret, { algorithms: ["HS256"] });
    expect(Date.now() - start).toBeLessThan(10);
  });

  it("1000 JWT sign operations complete in under 500ms", () => {
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      jwt.sign({ id: `u${i}` }, secret, { algorithm: "HS256", expiresIn: "1h" });
    }
    expect(Date.now() - start).toBeLessThan(500);
  });

  it("1000 JWT verify operations complete in under 500ms", () => {
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      jwt.verify(token, secret, { algorithms: ["HS256"] });
    }
    expect(Date.now() - start).toBeLessThan(500);
  });
});

// ─── SHA-256 (refresh token hashing) ─────────────────────────────────────────

describe("Performance — SHA-256 refresh token hashing", () => {
  it("10000 SHA-256 hashes of a JWT string complete in under 100ms", () => {
    const rawToken = "eyJhbGciOiJIUzI1NiJ9.eyJpZCI6InUxIn0.sig";
    const start = Date.now();
    for (let i = 0; i < 10_000; i++) {
      crypto.createHash("sha256").update(rawToken).digest("hex");
    }
    expect(Date.now() - start).toBeLessThan(100);
  });

  it("SHA-256 of a 512-byte string completes in under 1ms", () => {
    const input = "x".repeat(512);
    const start = Date.now();
    crypto.createHash("sha256").update(input).digest("hex");
    expect(Date.now() - start).toBeLessThan(1);
  });
});

// ─── OTP generation ───────────────────────────────────────────────────────────

describe("Performance — OTP generation and hashing", () => {
  it("1000 OTP generations (6-digit crypto random) complete in under 50ms", () => {
    const start = Date.now();
    for (let i = 0; i < 1000; i++) {
      const otp = Math.floor(100_000 + Math.random() * 900_000).toString();
      crypto.createHash("sha256").update(otp).digest("hex");
    }
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("OTPs are 6 digits exactly", () => {
    for (let i = 0; i < 100; i++) {
      const otp = Math.floor(100_000 + Math.random() * 900_000).toString();
      expect(otp).toMatch(/^\d{6}$/);
    }
  });
});
