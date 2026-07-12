import type { StoredFile } from "../../src/db/fileStore";
import type { StoredFileVersion } from "../../src/db/fileVersionStore";
import type { StoredVersionRequest } from "../../src/db/versionRequestStore";

jest.mock("../../src/services/file.service", () => ({
  MAX_USER_STORAGE_BYTES: 1 * 1024 * 1024 * 1024,
}));

jest.mock("../../src/services/s3.service", () => ({
  buildVersionKey: jest.fn((userId: string, fileId: string, v: number) => `uploads/${userId}/${fileId}/v${v}_key`),
  buildStagingKey: jest.fn((fileId: string) => `staging/${fileId}/pending_key`),
  putObject: jest.fn().mockResolvedValue(undefined),
  moveObject: jest.fn().mockResolvedValue(undefined),
  deleteObject: jest.fn().mockResolvedValue(undefined),
  getObjectStream: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/services/audit.service", () => ({
  logAction: jest.fn(),
}));

jest.mock("../../src/db/fileStore", () => ({
  getFileById: jest.fn(),
  getFilesByUser: jest.fn().mockResolvedValue([]),
  updateVersionPolicy: jest.fn(),
  updateFileVersionSummary: jest.fn(),
}));

jest.mock("../../src/db/fileVersionStore", () => ({
  createFileVersion: jest.fn(),
  getVersionsByFile: jest.fn(),
  getVersionById: jest.fn(),
  getActiveVersion: jest.fn(),
  getNextVersionNumber: jest.fn().mockResolvedValue(2),
  setActiveVersion: jest.fn(),
  deleteFileVersion: jest.fn(),
}));

jest.mock("../../src/db/versionRequestStore", () => ({
  createVersionRequest: jest.fn(),
  getVersionRequestById: jest.fn(),
  getPendingRequestsByFile: jest.fn(),
  getPendingRequestsForFiles: jest.fn(),
  updateVersionRequestStatus: jest.fn(),
}));

jest.mock("../../src/db/notificationStore", () => ({
  createNotification: jest.fn(),
}));

jest.mock("../../src/db/inMemoryStore", () => ({
  findUserById: jest.fn().mockResolvedValue({ id: "u", name: "Some User", email: "user@example.com" }),
}));

jest.mock("../../src/utils/email", () => ({
  sendVersionRequestEmail: jest.fn().mockResolvedValue(undefined),
  sendVersionApprovedEmail: jest.fn().mockResolvedValue(undefined),
  sendVersionRejectedEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../../src/utils/accessControl", () => {
  const actual = jest.requireActual("../../src/utils/accessControl");
  return {
    ...actual,
    getFilePermission: jest.fn(),
    requireFileAccess: jest.fn(),
  };
});

import * as s3Service from "../../src/services/s3.service";
import * as fileStore from "../../src/db/fileStore";
import * as fileVersionStore from "../../src/db/fileVersionStore";
import * as versionRequestStore from "../../src/db/versionRequestStore";
import * as notificationStore from "../../src/db/notificationStore";
import * as accessControl from "../../src/utils/accessControl";
import * as versionService from "../../src/services/version.service";

const mockGetFilePermission = jest.mocked(accessControl.getFilePermission);
const mockRequireFileAccess = jest.mocked(accessControl.requireFileAccess);
const mockPutObject = jest.mocked(s3Service.putObject);
const mockMoveObject = jest.mocked(s3Service.moveObject);
const mockDeleteObject = jest.mocked(s3Service.deleteObject);
const mockCreateFileVersion = jest.mocked(fileVersionStore.createFileVersion);
const mockGetVersionById = jest.mocked(fileVersionStore.getVersionById);
const mockSetActiveVersion = jest.mocked(fileVersionStore.setActiveVersion);
const mockDeleteFileVersion = jest.mocked(fileVersionStore.deleteFileVersion);
const mockGetVersionRequestById = jest.mocked(versionRequestStore.getVersionRequestById);
const mockUpdateVersionRequestStatus = jest.mocked(versionRequestStore.updateVersionRequestStatus);
const mockCreateVersionRequest = jest.mocked(versionRequestStore.createVersionRequest);
const mockCreateNotification = jest.mocked(notificationStore.createNotification);
const mockUpdateVersionPolicy = jest.mocked(fileStore.updateVersionPolicy);

function baseFile(overrides: Partial<StoredFile> = {}): StoredFile {
  return {
    id: "file-1",
    name: "report.pdf",
    userId: "owner-1",
    originalName: "report.pdf",
    mimeType: "application/pdf",
    size: 1024,
    diskPath: "",
    publicUrl: "/api/files/file-1/download",
    adminOnlyChat: false,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    isEncrypted: false,
    versionPolicy: "admin_only",
    activeVersionId: "v1",
    ...overrides,
  } as StoredFile;
}

function multerFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: "file",
    originalname: "new.pdf",
    encoding: "7bit",
    mimetype: "application/pdf",
    size: 2048,
    destination: "",
    filename: "",
    path: "",
    buffer: Buffer.from("%PDF-1.7"),
    stream: undefined as never,
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("uploadVersionDirect", () => {
  it("denies when the user has no access to the file", async () => {
    mockGetFilePermission.mockResolvedValue(null);
    await expect(
      versionService.uploadVersionDirect("file-1", "stranger", multerFile(), {}),
    ).rejects.toThrow("Access denied.");
    expect(mockPutObject).not.toHaveBeenCalled();
  });

  it("denies a viewer under the admin_only policy", async () => {
    const file = baseFile({ versionPolicy: "admin_only" });
    mockGetFilePermission.mockResolvedValue({ file, role: "viewer" });
    await expect(
      versionService.uploadVersionDirect("file-1", "viewer-1", multerFile(), {}),
    ).rejects.toThrow("Access denied.");
    expect(mockPutObject).not.toHaveBeenCalled();
  });

  it("lets the owner upload directly and records it as the next version", async () => {
    const file = baseFile({ versionPolicy: "admin_only" });
    mockGetFilePermission.mockResolvedValue({ file, role: "owner" });
    mockCreateFileVersion.mockResolvedValue({ id: "v2", versionNumber: 2 } as StoredFileVersion);

    const result = await versionService.uploadVersionDirect("file-1", "owner-1", multerFile(), {
      changeNote: "fixed typo",
    });

    expect(mockPutObject).toHaveBeenCalledWith(
      expect.stringContaining("uploads/owner-1/file-1/v2"),
      expect.any(Buffer),
      "application/pdf",
    );
    expect(mockCreateFileVersion).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "file-1", versionNumber: 2, uploadedBy: "owner-1", changeNote: "fixed typo" }),
    );
    expect(result.id).toBe("v2");
  });

  it("lets a viewer upload directly under the open policy", async () => {
    const file = baseFile({ versionPolicy: "open" });
    mockGetFilePermission.mockResolvedValue({ file, role: "viewer" });
    mockCreateFileVersion.mockResolvedValue({ id: "v2", versionNumber: 2 } as StoredFileVersion);

    await versionService.uploadVersionDirect("file-1", "viewer-1", multerFile(), {});
    expect(mockPutObject).toHaveBeenCalled();
  });
});

describe("requestVersionUpload", () => {
  it("denies a viewer under the role_gated policy (viewers cannot even request)", async () => {
    const file = baseFile({ versionPolicy: "role_gated" });
    mockGetFilePermission.mockResolvedValue({ file, role: "viewer" });
    await expect(
      versionService.requestVersionUpload("file-1", "viewer-1", multerFile(), {}),
    ).rejects.toThrow("Access denied.");
  });

  it("stages the file and notifies the owner for an editor under role_gated", async () => {
    const file = baseFile({ versionPolicy: "role_gated" });
    mockGetFilePermission.mockResolvedValue({ file, role: "editor" });
    mockCreateVersionRequest.mockResolvedValue({ id: "req-1", status: "pending" } as StoredVersionRequest);

    const result = await versionService.requestVersionUpload("file-1", "editor-1", multerFile(), {
      changeNote: "quarterly update",
    });

    expect(mockPutObject).toHaveBeenCalledWith(
      expect.stringContaining("staging/file-1"),
      expect.any(Buffer),
      "application/pdf",
    );
    expect(mockCreateVersionRequest).toHaveBeenCalledWith(
      expect.objectContaining({ fileId: "file-1", requestedBy: "editor-1", changeNote: "quarterly update" }),
    );
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: file.userId, type: "version_request" }),
    );
    expect(result.id).toBe("req-1");
  });
});

describe("approveVersionRequest", () => {
  it("throws if the request is not pending", async () => {
    const file = baseFile();
    mockRequireFileAccess.mockResolvedValue({ file, role: "owner" });
    mockGetVersionRequestById.mockResolvedValue({
      id: "req-1",
      fileId: "file-1",
      status: "approved",
    } as StoredVersionRequest);

    await expect(
      versionService.approveVersionRequest("file-1", "req-1", "owner-1"),
    ).rejects.toThrow("already been reviewed");
    expect(mockMoveObject).not.toHaveBeenCalled();
  });

  it("moves the staged object, creates the version, and notifies the requester", async () => {
    const file = baseFile();
    mockRequireFileAccess.mockResolvedValue({ file, role: "owner" });
    mockGetVersionRequestById.mockResolvedValue({
      id: "req-1",
      fileId: "file-1",
      status: "pending",
      requestedBy: "editor-1",
      stagingS3Key: "staging/file-1/pending_key",
      size: 2048,
      mimeType: "application/pdf",
      isEncrypted: false,
      originalName: "new.pdf",
    } as StoredVersionRequest);
    mockCreateFileVersion.mockResolvedValue({ id: "v2", versionNumber: 2 } as StoredFileVersion);

    const version = await versionService.approveVersionRequest("file-1", "req-1", "owner-1");

    expect(mockMoveObject).toHaveBeenCalledWith("staging/file-1/pending_key", expect.stringContaining("v2"));
    expect(mockUpdateVersionRequestStatus).toHaveBeenCalledWith("req-1", "approved", "owner-1");
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "editor-1", type: "version_approved" }),
    );
    expect(version.id).toBe("v2");
  });
});

describe("rejectVersionRequest", () => {
  it("deletes the staged object and notifies the requester", async () => {
    const file = baseFile();
    mockRequireFileAccess.mockResolvedValue({ file, role: "owner" });
    mockGetVersionRequestById.mockResolvedValue({
      id: "req-1",
      fileId: "file-1",
      status: "pending",
      requestedBy: "editor-1",
      stagingS3Key: "staging/file-1/pending_key",
    } as StoredVersionRequest);
    mockUpdateVersionRequestStatus.mockResolvedValue({ id: "req-1", status: "rejected" } as StoredVersionRequest);

    await versionService.rejectVersionRequest("file-1", "req-1", "owner-1");

    expect(mockDeleteObject).toHaveBeenCalledWith("staging/file-1/pending_key");
    expect(mockUpdateVersionRequestStatus).toHaveBeenCalledWith("req-1", "rejected", "owner-1");
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "editor-1", type: "version_rejected" }),
    );
  });
});

describe("activateVersion", () => {
  it("promotes the version and mirrors its metadata onto the file record", async () => {
    const file = baseFile();
    mockRequireFileAccess.mockResolvedValue({ file, role: "owner" });
    mockGetVersionById.mockResolvedValue({ id: "v2", fileId: "file-1", versionNumber: 2 } as StoredFileVersion);
    mockSetActiveVersion.mockResolvedValue({
      id: "v2",
      versionNumber: 2,
      size: 5000,
      mimeType: "application/pdf",
      isEncrypted: false,
    } as StoredFileVersion);

    const result = await versionService.activateVersion("file-1", "v2", "owner-1");

    expect(mockSetActiveVersion).toHaveBeenCalledWith("file-1", "v2");
    expect(fileStore.updateFileVersionSummary).toHaveBeenCalledWith("file-1", {
      size: 5000,
      mimeType: "application/pdf",
      isEncrypted: false,
    });
    expect(result.versionNumber).toBe(2);
  });
});

describe("deleteVersion", () => {
  it("refuses to delete the active version", async () => {
    const file = baseFile();
    mockRequireFileAccess.mockResolvedValue({ file, role: "owner" });
    mockGetVersionById.mockResolvedValue({ id: "v1", fileId: "file-1", isActive: true } as StoredFileVersion);

    await expect(versionService.deleteVersion("file-1", "v1", "owner-1")).rejects.toThrow(
      "Cannot delete the active version",
    );
    expect(mockDeleteObject).not.toHaveBeenCalled();
  });

  it("deletes a non-active version's S3 object and record", async () => {
    const file = baseFile();
    mockRequireFileAccess.mockResolvedValue({ file, role: "owner" });
    mockGetVersionById.mockResolvedValue({
      id: "v1",
      fileId: "file-1",
      isActive: false,
      s3Key: "uploads/owner-1/file-1/v1_key",
    } as StoredFileVersion);

    await versionService.deleteVersion("file-1", "v1", "owner-1");

    expect(mockDeleteObject).toHaveBeenCalledWith("uploads/owner-1/file-1/v1_key");
    expect(mockDeleteFileVersion).toHaveBeenCalledWith("v1");
  });
});

describe("updateVersionPolicy", () => {
  it("rejects an invalid policy value", async () => {
    const file = baseFile();
    mockRequireFileAccess.mockResolvedValue({ file, role: "owner" });

    await expect(
      versionService.updateVersionPolicy("file-1", "owner-1", "not-a-real-policy"),
    ).rejects.toThrow("Invalid version policy.");
    expect(mockUpdateVersionPolicy).not.toHaveBeenCalled();
  });

  it("persists a valid policy change", async () => {
    const file = baseFile();
    mockRequireFileAccess.mockResolvedValue({ file, role: "owner" });

    const result = await versionService.updateVersionPolicy("file-1", "owner-1", "open");

    expect(mockUpdateVersionPolicy).toHaveBeenCalledWith("file-1", "open");
    expect(result).toBe("open");
  });
});
