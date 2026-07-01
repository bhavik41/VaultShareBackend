import { getVersionUploadDecision } from "../../src/utils/accessControl";

describe("getVersionUploadDecision", () => {
  it("always lets the owner upload directly, regardless of policy", () => {
    expect(getVersionUploadDecision("admin_only", "owner")).toBe("direct");
    expect(getVersionUploadDecision("role_gated", "owner")).toBe("direct");
    expect(getVersionUploadDecision("open", "owner")).toBe("direct");
  });

  describe("admin_only policy", () => {
    it("denies editors and viewers", () => {
      expect(getVersionUploadDecision("admin_only", "editor")).toBe("denied");
      expect(getVersionUploadDecision("admin_only", "viewer")).toBe("denied");
    });
  });

  describe("role_gated policy", () => {
    it("lets editors submit a request, but not upload directly", () => {
      expect(getVersionUploadDecision("role_gated", "editor")).toBe("request");
    });

    it("denies viewers", () => {
      expect(getVersionUploadDecision("role_gated", "viewer")).toBe("denied");
    });
  });

  describe("open policy", () => {
    it("lets editors and viewers upload directly", () => {
      expect(getVersionUploadDecision("open", "editor")).toBe("direct");
      expect(getVersionUploadDecision("open", "viewer")).toBe("direct");
    });
  });
});
