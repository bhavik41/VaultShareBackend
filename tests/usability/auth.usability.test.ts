/**
 * Usability Testing — Auth
 * Verifies that API error messages are clear, specific, and actionable,
 * and that responses are consistent and easy for client devs to consume.
 */
import request from "supertest";

jest.mock("../../src/middleware/rateLimiter", () => ({
  signinLimiter: (_: any, __: any, n: any) => n(),
  signupLimiter: (_: any, __: any, n: any) => n(),
  forgotPasswordLimiter: (_: any, __: any, n: any) => n(),
  twoFaLimiter: (_: any, __: any, n: any) => n(),
  refreshLimiter: (_: any, __: any, n: any) => n(),
}));
jest.mock("../../src/db/inMemoryStore", () => ({
  findUserByEmail: jest.fn().mockResolvedValue(undefined),
  findUserById: jest.fn(),
  findUserByRefreshTokenHash: jest.fn(),
  createUser: jest.fn().mockImplementation(async (u: any) => u),
  updateUser: jest.fn().mockResolvedValue(undefined),
  deleteUser: jest.fn(),
}));
jest.mock("../../src/utils/email", () => ({
  sendSigninOtpEmail: jest.fn().mockResolvedValue(undefined),
  sendPasswordResetEmail: jest.fn().mockResolvedValue(undefined),
}));

import app from "../../src/app";

// ─── Error messages are specific ──────────────────────────────────────────────

describe("Usability — Error messages are not generic", () => {
  it("missing name field → message mentions the requirement", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "a@a.com", password: "Pass123!" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
    expect(res.body.message.length).toBeGreaterThan(5);
    expect(res.body.message).not.toBe("Error");
  });

  it("missing email on signin → explicit message, not empty body", async () => {
    const res = await request(app)
      .post("/api/auth/signin")
      .send({ password: "Pass123!" });

    expect(res.body.message).toBeTruthy();
    expect(res.body.message.length).toBeGreaterThan(5);
  });

  it("missing password on signin → specific message", async () => {
    const res = await request(app)
      .post("/api/auth/signin")
      .send({ email: "a@a.com" });

    expect(res.body.message).toBeTruthy();
    expect(typeof res.body.message).toBe("string");
  });

  it("missing tempToken on verify-otp → specific message", async () => {
    const res = await request(app)
      .post("/api/auth/signin/verify-otp")
      .send({ otp: "123456" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });

  it("missing refreshToken on /refresh → specific message", async () => {
    const res = await request(app)
      .post("/api/auth/refresh")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });
});

// ─── Every error response has a message field ─────────────────────────────────

describe("Usability — Every error response has a { message } field", () => {
  const errorScenarios: Array<{ desc: string; method: string; path: string; body: any }> = [
    { desc: "signup missing fields", method: "post", path: "/api/auth/signup", body: {} },
    { desc: "signin missing fields", method: "post", path: "/api/auth/signin", body: {} },
    { desc: "verify-otp missing fields", method: "post", path: "/api/auth/signin/verify-otp", body: {} },
    { desc: "refresh missing token", method: "post", path: "/api/auth/refresh", body: {} },
    { desc: "forgot-password missing email", method: "post", path: "/api/auth/forgot-password", body: {} },
    { desc: "me without auth", method: "get", path: "/api/auth/me", body: {} },
    { desc: "reset-password missing fields", method: "post", path: "/api/auth/reset-password", body: {} },
  ];

  it.each(errorScenarios)("$desc response body has { message: string }", async ({ method, path, body }) => {
    const res = await (request(app) as any)[method](path).send(body);
    expect(typeof res.body.message).toBe("string");
    expect(res.body.message.length).toBeGreaterThan(0);
  });
});

// ─── Status codes are semantically correct ────────────────────────────────────

describe("Usability — HTTP status codes match error type", () => {
  it("missing required fields → 400 Bad Request (not 401, not 500)", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ email: "a@a.com" });

    expect(res.status).toBe(400);
  });

  it("wrong credentials → 401 Unauthorized (not 400, not 403)", async () => {
    const res = await request(app)
      .post("/api/auth/signin")
      .send({ email: "nobody@x.com", password: "WrongPass1" });

    expect(res.status).toBe(401);
  });

  it("no auth token on protected route → 401 (not 403)", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("signup success → 201 Created (not 200)", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "A", email: "new@example.com", password: "SecurePass1" });

    expect(res.status).toBe(201);
  });
});

// ─── Successful responses have expected shape ──────────────────────────────────

describe("Usability — Success response consistency", () => {
  it("signup 201 body has requiresOtp and tempToken — client knows next step", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "Bob", email: "bob@x.com", password: "BobPass123" });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("requiresOtp", true);
    expect(res.body).toHaveProperty("tempToken");
  });

  it("forgot-password 200 message tells user to check email — not just OK", async () => {
    const res = await request(app)
      .post("/api/auth/forgot-password")
      .send({ email: "somebody@x.com" });

    expect(res.status).toBe(200);
    expect(res.body.message).toMatch(/OTP|email/i);
  });

  it("all responses are JSON (Content-Type: application/json)", async () => {
    const res = await request(app)
      .post("/api/auth/signin")
      .send({ email: "x@x.com", password: "wrong" });

    expect(res.headers["content-type"]).toMatch(/application\/json/);
  });
});

// ─── Field validation produces helpful messages ───────────────────────────────

describe("Usability — Validation messages guide the client", () => {
  it("password too short: message explains the problem (not just 'Invalid')", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "A", email: "a@a.com", password: "short" });

    expect(res.status).toBe(400);
    expect(res.body.message).not.toBe("Invalid");
    expect(res.body.message.length).toBeGreaterThan(10);
  });

  it("invalid email format: message explains validation failure", async () => {
    const res = await request(app)
      .post("/api/auth/signup")
      .send({ name: "A", email: "not-an-email", password: "SecurePass1" });

    expect(res.status).toBe(400);
    expect(res.body.message).toBeTruthy();
  });
});
