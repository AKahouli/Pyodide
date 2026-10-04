export const UPLOAD_SESSION_STORE = Symbol('UPLOAD_SESSION_STORE');

export interface UploadSessionFileRecord {
  index: number;
  filename: string;
  mimeType: string;
  size: number;
  documentId?: string;
  uploadUrl?: string;
  status: string;
  progress: number;
  error?: string;
}

export interface UploadSessionRecord {
  id: string;
  workspaceId: string;
  userId: string;
  status: string;
  files: UploadSessionFileRecord[];
  totalFiles: number;
  totalSize: number;
  completedFiles: number;
  failedFiles: number;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface UploadSessionCreateInput {
  workspaceId: string;
  userId: string;
  status: string;
  files: (Omit<UploadSessionFileRecord, 'documentId' | 'error'> & { documentId?: string })[];
  totalFiles: number;
  totalSize: number;
  completedFiles: number;
  failedFiles: number;
  expiresAt: Date;
}

/**
 * Internal store for bulk-upload sessions. The Mongo representation embeds the
 * files array; PG splits it into upload_session_files (plan D.2: per-file
 * progress is a single-row UPDATE). The interface is therefore shaped around
 * per-file operations, never raw array pokes.
 */
export interface UploadSessionStore {
  create(input: UploadSessionCreateInput): Promise<UploadSessionRecord>;
  findByIdWorkspaceUser(sessionId: string, workspaceId: string, userId: string): Promise<UploadSessionRecord | null>;
  /** Sessions still pending/in-progress whose expiresAt is before `now`. */
  /** Oldest-first expired pending/in-progress sessions, at most `limit` (default 500). */
  findExpired(now: Date, limit?: number): Promise<UploadSessionRecord[]>;
  /** Single-file progress write (Mongo: embedded entry; PG: one upload_session_files row). */
  updateFileProgress(sessionId: string, fileIndex: number, patch: { status?: string; progress?: number; error?: string }): Promise<void>;
  setStatus(sessionId: string, status: string): Promise<void>;
  setOutcome(sessionId: string, outcome: { status: string; completedFiles: number; failedFiles: number }): Promise<void>;
  markExpired(sessionId: string): Promise<void>;
  /** Children (PG) cascade via FK; Mongo deletes the embedded documents. */
  deleteManyByWorkspace(workspaceId: string): Promise<void>;
}
