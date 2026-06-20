import { v4 as uuidv4 } from "uuid";

export type AuditAction = 
  | "upload"
  | "download"
  | "view"
  | "share"
  | "permission_change"
  | "delete";

export interface AuditLog {
  id: string;
  fileId: string;
  userId: string;
  action: AuditAction;
  details?: string;
  timestamp: Date;
}

const auditLogs: Map<string, AuditLog> = new Map();

export const createAuditLog = (
  fileId: string,
  userId: string,
  action: AuditAction,
  details?: string
): AuditLog => {
  const log: AuditLog = {
    id: uuidv4(),
    fileId,
    userId,
    action,
    details,
    timestamp: new Date(),
  };
  auditLogs.set(log.id, log);
  return log;
};

export const getAuditLogsByFile = (fileId: string): AuditLog[] => {
  return Array.from(auditLogs.values())
    .filter((log) => log.fileId === fileId)
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()); // newest first
};
