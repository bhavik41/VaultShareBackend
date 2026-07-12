import type { StoredFile } from "../../src/db/fileStore";
import type { CollaborationInvitation } from "../../src/db/collaborationStore";
import type { StoredUser } from "../../src/db/inMemoryStore";

jest.mock("../../src/db/fileStore", () => ({
  getFileById: jest.fn(),
  getFilesByIds: jest.fn(),
}));

jest.mock("../../src/db/inMemoryStore", () => ({
  findUserByEmail: jest.fn(),
  findUserById: jest.fn(),
  findUsersByIds: jest.fn(),
}));

jest.mock("../../src/db/collaborationStore", () => ({
  createFileShare: jest.fn(),
  createInvitation: jest.fn(),
  createShareLink: jest.fn(),
  findPendingInvitation: jest.fn(),
  getFileShare: jest.fn(),
  getInvitationById: jest.fn(),
  getInvitationsByFile: jest.fn(),
  getInvitationsForUser: jest.fn(),
  getShareLinkByToken: jest.fn(),
  getShareLinksByFile: jest.fn(),
  getSharesByFile: jest.fn(),
  getSharesByUser: jest.fn(),
  removeFileShare: jest.fn(),
  revokeShareLink: jest.fn(),
  updateFileShareRole: jest.fn(),
  updateInvitationStatus: jest.fn(),
}));

jest.mock("../../src/services/audit.service", () => ({
  logAction: jest.fn(),
}));

import { getFileById } from "../../src/db/fileStore";
import { findUserByEmail } from "../../src/db/inMemoryStore";
import {
  createInvitation,
  findPendingInvitation,
  getFileShare,
} from "../../src/db/collaborationStore";
import {
  inviteCollaborator,
  parseExpirationDate,
  validateSharedRole,
} from "../../src/services/collaboration.service";

const mockGetFileById = jest.mocked(getFileById);
const mockFindUserByEmail = jest.mocked(findUserByEmail);
const mockGetFileShare = jest.mocked(getFileShare);
const mockFindPendingInvitation = jest.mocked(findPendingInvitation);
const mockCreateInvitation = jest.mocked(createInvitation);

const file: StoredFile = {
  id: "file-1",
  name: "report.pdf",
  userId: "owner-1",
  originalName: "report.pdf",
  mimeType: "application/pdf",
  size: 1024,
  diskPath: "/tmp/report.pdf",
  publicUrl: "/uploads/report.pdf",
  adminOnlyChat: false,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  isEncrypted: false,
  versionPolicy: "admin_only",
  activeVersionId: null,
};

function user(overrides: Partial<StoredUser>): StoredUser {
  return {
    id: overrides.id ?? "user-1",
    name: overrides.name ?? "Test User",
    email: overrides.email ?? "user@example.com",
    passwordHash: overrides.passwordHash ?? "hash",
    createdAt: overrides.createdAt ?? new Date("2026-01-01T00:00:00.000Z"),
    refreshToken: overrides.refreshToken ?? null,
    twoFactorSecret: overrides.twoFactorSecret ?? null,
    twoFactorEnabled: overrides.twoFactorEnabled ?? false,
    lastUsedTotpCode: overrides.lastUsedTotpCode ?? null,
    lastUsedTotpAt: overrides.lastUsedTotpAt ?? null,
    resetOtp: overrides.resetOtp ?? null,
    resetOtpExpiry: overrides.resetOtpExpiry ?? null,
    signinOtp: overrides.signinOtp ?? null,
    signinOtpExpiry: overrides.signinOtpExpiry ?? null,
    signinOtpAttempts: overrides.signinOtpAttempts ?? 0,
    failedLoginAttempts: overrides.failedLoginAttempts ?? 0,
    lockoutUntil: overrides.lockoutUntil ?? null,
    emailVerified: overrides.emailVerified ?? true,
  };
}

function pendingInvitation(): CollaborationInvitation {
  return {
    id: "invitation-1",
    fileId: file.id,
    inviterId: file.userId,
    inviteeId: "invitee-1",
    inviteeEmail: "invitee@example.com",
    role: "viewer",
    status: "pending",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

beforeEach(() => {
  mockGetFileById.mockResolvedValue(file);
  mockFindUserByEmail.mockResolvedValue(user({ id: "invitee-1", email: "invitee@example.com" }));
  mockGetFileShare.mockResolvedValue(undefined);
  mockFindPendingInvitation.mockResolvedValue(undefined);
  mockCreateInvitation.mockImplementation(async (invitation) => invitation);
});

describe("collaboration role and expiry validation", () => {
  it("accepts editor as a shared role", () => {
    expect(validateSharedRole("editor")).toBe("editor");
  });

  it("rejects owner as a shared role", () => {
    expect(() => validateSharedRole("owner")).toThrow("Role must be either editor or viewer.");
  });

  it("rejects expiration dates in the past", () => {
    expect(() => parseExpirationDate("2020-01-01T00:00:00.000Z")).toThrow(
      "expiresAt must be in the future.",
    );
  });

  it("rejects invalid expiration date strings", () => {
    expect(() => parseExpirationDate("not-a-date")).toThrow(
      "expiresAt must be a valid date.",
    );
  });
});

describe("inviteCollaborator", () => {
  it("rejects self-invites", async () => {
    mockFindUserByEmail.mockResolvedValue(user({ id: "owner-1", email: "owner@example.com" }));

    await expect(
      inviteCollaborator({
        fileId: file.id,
        inviterId: "owner-1",
        inviteeEmail: "owner@example.com",
        role: "viewer",
      }),
    ).rejects.toThrow("You cannot invite yourself to your own file.");
  });

  it("rejects duplicate pending invitations", async () => {
    mockFindPendingInvitation.mockResolvedValue(pendingInvitation());

    await expect(
      inviteCollaborator({
        fileId: file.id,
        inviterId: "owner-1",
        inviteeEmail: "invitee@example.com",
        role: "viewer",
      }),
    ).rejects.toThrow("A pending invitation already exists for this user.");

    expect(mockCreateInvitation).not.toHaveBeenCalled();
  });
});
