import { getAllFiles, getFilesByUser, StoredFile } from "../db/fileStore";
import {
  FileShare,
  getSharesByFile,
  getSharesByUser,
} from "../db/collaborationStore";
import { findUserById } from "../db/inMemoryStore";

export type DashboardOwnershipFilter = "all" | "owned" | "shared";
export type DashboardSortOption =
  | "name_asc"
  | "name_desc"
  | "date_newest"
  | "date_oldest"
  | "size_asc"
  | "size_desc"
  | "type_asc";

export interface DashboardFilters {
  query?: string;
  fileType?: string;
  ownership?: DashboardOwnershipFilter;
  sort?: DashboardSortOption;
}

export interface DashboardCollaborator {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: "editor" | "viewer";
}

export interface DashboardDocument {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  ownership: "owned" | "shared";
  accessLevel: "owner" | "editor" | "viewer";
  permissionStatus: string;
  createdAt: Date;
  sharedAt?: Date;
  collaborators: DashboardCollaborator[];
}

export interface DashboardActivity {
  id: string;
  type: "uploaded" | "shared_with_me" | "shared_by_me";
  message: string;
  fileId: string;
  fileName: string;
  createdAt: Date;
}

function ownerInfo(ownerId: string) {
  const owner = findUserById(ownerId);

  return {
    ownerName: owner?.name ?? "Unknown user",
    ownerEmail: owner?.email ?? "",
  };
}

function collaboratorsFor(fileId: string): DashboardCollaborator[] {
  return getSharesByFile(fileId).map((share) => {
    const user = findUserById(share.userId);

    return {
      id: share.id,
      userId: share.userId,
      name: user?.name ?? "Unknown user",
      email: user?.email ?? "",
      role: share.role,
    };
  });
}

function ownedDocument(file: StoredFile): DashboardDocument {
  const owner = ownerInfo(file.userId);

  return {
    id: file.id,
    name: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    ownerId: file.userId,
    ...owner,
    ownership: "owned",
    accessLevel: "owner",
    permissionStatus: "Owner access",
    createdAt: file.createdAt,
    collaborators: collaboratorsFor(file.id),
  };
}

function sharedDocument(share: FileShare): DashboardDocument | null {
  const file = getAllFiles().find((item) => item.id === share.fileId);
  if (!file) return null;

  const owner = ownerInfo(share.ownerId);

  return {
    id: file.id,
    name: file.originalName,
    mimeType: file.mimeType,
    size: file.size,
    ownerId: share.ownerId,
    ...owner,
    ownership: "shared",
    accessLevel: share.role,
    permissionStatus:
      share.role === "editor" ? "Can view and edit" : "Can view",
    createdAt: file.createdAt,
    sharedAt: share.createdAt,
    collaborators: collaboratorsFor(file.id),
  };
}

function normalize(value?: string): string {
  return value?.trim().toLowerCase() ?? "";
}

function matchesFileType(document: DashboardDocument, fileType?: string): boolean {
  const normalizedType = normalize(fileType);
  if (!normalizedType || normalizedType === "all") return true;

  return (
    document.mimeType.toLowerCase().includes(normalizedType) ||
    document.name.toLowerCase().endsWith(`.${normalizedType}`)
  );
}

function filterDocuments(
  documents: DashboardDocument[],
  filters: DashboardFilters,
): DashboardDocument[] {
  const query = normalize(filters.query);
  const ownership = filters.ownership ?? "all";

  return documents.filter((document) => {
    const matchesQuery =
      !query ||
      document.name.toLowerCase().includes(query) ||
      document.ownerName.toLowerCase().includes(query) ||
      document.ownerEmail.toLowerCase().includes(query);

    const matchesOwnership =
      ownership === "all" || document.ownership === ownership;

    return (
      matchesQuery &&
      matchesOwnership &&
      matchesFileType(document, filters.fileType)
    );
  });
}

function sortDocuments(
  documents: DashboardDocument[],
  sort: DashboardSortOption = "date_newest",
): DashboardDocument[] {
  return [...documents].sort((left, right) => {
    switch (sort) {
      case "name_asc":
        return left.name.localeCompare(right.name);
      case "name_desc":
        return right.name.localeCompare(left.name);
      case "date_oldest":
        return left.createdAt.getTime() - right.createdAt.getTime();
      case "size_asc":
        return left.size - right.size;
      case "size_desc":
        return right.size - left.size;
      case "type_asc":
        return left.mimeType.localeCompare(right.mimeType);
      case "date_newest":
      default:
        return right.createdAt.getTime() - left.createdAt.getTime();
    }
  });
}

export function listDashboardDocuments(
  userId: string,
  filters: DashboardFilters = {},
): DashboardDocument[] {
  const uploaded = getFilesByUser(userId).map(ownedDocument);
  const shared = getSharesByUser(userId)
    .map(sharedDocument)
    .filter((document): document is DashboardDocument => document !== null);

  return sortDocuments(filterDocuments([...uploaded, ...shared], filters), filters.sort);
}

export function getDashboardStats(userId: string) {
  const documents = listDashboardDocuments(userId);
  const uploadedFiles = documents.filter((document) => document.ownership === "owned");
  const sharedFiles = documents.filter((document) => document.ownership === "shared");
  const sharedByMe = uploadedFiles.filter(
    (document) => document.collaborators.length > 0,
  );

  const fileTypes = documents.reduce<Record<string, number>>((summary, document) => {
    const type = document.mimeType.split("/")[1] ?? document.mimeType;
    summary[type] = (summary[type] ?? 0) + 1;
    return summary;
  }, {});

  return {
    totalDocuments: documents.length,
    uploadedCount: uploadedFiles.length,
    sharedWithMeCount: sharedFiles.length,
    sharedByMeCount: sharedByMe.length,
    totalStorageBytes: uploadedFiles.reduce((total, file) => total + file.size, 0),
    fileTypes,
  };
}

export function getRecentActivity(userId: string): DashboardActivity[] {
  const uploadedActivities = getFilesByUser(userId).map((file) => ({
    id: `uploaded-${file.id}`,
    type: "uploaded" as const,
    message: `Uploaded ${file.originalName}`,
    fileId: file.id,
    fileName: file.originalName,
    createdAt: file.createdAt,
  }));

  const sharedWithMeActivities = getSharesByUser(userId)
    .map((share) => sharedDocument(share))
    .filter((document): document is DashboardDocument => document !== null)
    .map((document) => ({
      id: `shared-with-me-${document.id}`,
      type: "shared_with_me" as const,
      message: `${document.ownerName} shared ${document.name} with you`,
      fileId: document.id,
      fileName: document.name,
      createdAt: document.sharedAt ?? document.createdAt,
    }));

  const sharedByMeActivities = getFilesByUser(userId).flatMap((file) =>
    getSharesByFile(file.id).map((share) => {
      const collaborator = findUserById(share.userId);

      return {
        id: `shared-by-me-${share.id}`,
        type: "shared_by_me" as const,
        message: `Shared ${file.originalName} with ${collaborator?.name ?? "a collaborator"}`,
        fileId: file.id,
        fileName: file.originalName,
        createdAt: share.createdAt,
      };
    }),
  );

  return [
    ...uploadedActivities,
    ...sharedWithMeActivities,
    ...sharedByMeActivities,
  ]
    .sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())
    .slice(0, 10);
}

export function getDashboardOverview(userId: string, filters: DashboardFilters = {}) {
  const documents = listDashboardDocuments(userId, filters);

  return {
    documents,
    uploadedFiles: documents.filter((document) => document.ownership === "owned"),
    sharedFiles: documents.filter((document) => document.ownership === "shared"),
    stats: getDashboardStats(userId),
    recentActivity: getRecentActivity(userId),
  };
}
