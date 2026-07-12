import type { StoredFile } from "../../src/db/fileStore";
import type { FileShare } from "../../src/db/collaborationStore";

jest.mock("../../src/db/fileStore", () => ({
  getFileById: jest.fn(),
}));

jest.mock("../../src/db/collaborationStore", () => ({
  getFileShare: jest.fn(),
}));

jest.mock("../../src/db/groupStore", () => ({
  getGroupsForUser: jest.fn().mockResolvedValue([]),
  getGroupFileShare: jest.fn().mockResolvedValue(undefined),
}));

import { getFileById } from "../../src/db/fileStore";
import { getFileShare } from "../../src/db/collaborationStore";
import { getFilePermission, requireFileAccess } from "../../src/utils/accessControl";

const mockGetFileById = jest.mocked(getFileById);
const mockGetFileShare = jest.mocked(getFileShare);

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

function share(role: FileShare["role"]): FileShare {
  return {
    id: `share-${role}`,
    fileId: file.id,
    ownerId: file.userId,
    userId: "collaborator-1",
    role,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  };
}

beforeEach(() => {
  mockGetFileById.mockResolvedValue(file);
  mockGetFileShare.mockResolvedValue(undefined);
});

it("returns owner role when the file owner accesses their own file", async () => {
  await expect(getFilePermission(file.id, file.userId)).resolves.toEqual({
    file,
    role: "owner",
  });
  expect(mockGetFileShare).not.toHaveBeenCalled();
});

it("denies a viewer trying an edit action", async () => {
  mockGetFileShare.mockResolvedValue(share("viewer"));

  await expect(requireFileAccess(file.id, "collaborator-1", "edit")).rejects.toThrow(
    "Access denied.",
  );
});

it("allows an editor trying an edit action", async () => {
  mockGetFileShare.mockResolvedValue(share("editor"));

  await expect(requireFileAccess(file.id, "collaborator-1", "edit")).resolves.toEqual({
    file,
    role: "editor",
  });
});

it("denies an editor trying an owner action", async () => {
  mockGetFileShare.mockResolvedValue(share("editor"));

  await expect(requireFileAccess(file.id, "collaborator-1", "owner")).rejects.toThrow(
    "Access denied.",
  );
});

it("returns null when there is no share record and the user is not the owner", async () => {
  await expect(getFilePermission(file.id, "stranger-1")).resolves.toBeNull();
});

it("throws when the file does not exist", async () => {
  mockGetFileById.mockResolvedValue(undefined);

  await expect(getFilePermission("missing-file", "user-1")).rejects.toThrow("File not found.");
});
