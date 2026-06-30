/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  setupFiles: ["<rootDir>/tests/setupEnv.ts"],
  testMatch: ["**/*.test.ts"],
  clearMocks: true,
  restoreMocks: true,
  collectCoverageFrom: ["src/**/*.ts", "!src/server.ts"],
};
