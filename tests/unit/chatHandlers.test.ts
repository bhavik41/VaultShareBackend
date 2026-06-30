import { isNonEmptyString, validateContent } from "../../src/socketio/chatHandlers";

describe("chat handler validation helpers", () => {
  it("rejects empty content", () => {
    expect(validateContent("")).toBe(false);
    expect(validateContent("   ")).toBe(false);
  });

  it("rejects content over 2000 characters", () => {
    expect(validateContent("x".repeat(2001))).toBe(false);
  });

  it("accepts valid content", () => {
    expect(validateContent("hello team")).toBe(true);
  });

  it("rejects undefined and whitespace-only non-empty string checks", () => {
    expect(isNonEmptyString(undefined)).toBe(false);
    expect(isNonEmptyString("   ")).toBe(false);
  });
});
