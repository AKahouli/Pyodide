import { UploadSessionStatus } from './upload-session-status.enum';
import { DocumentResponse } from './workspace-document.interface';

export interface InitiateBulkUploadData {
  files: Array<{
    filename: string;
    mimeType: string;
    size: number;
  }>;
}

export interface BulkUploadInitResponse {
  sessionId: string;
  files: Array<{
    index: number;
    filename: string;
    uploadUrl: string;
    documentId: string;
  }>;
  expiresAt: string;
}

export interface ReportProgressData {
  fileIndex: number;
  progress: number;
  status: 'uploading' | 'completed' | 'failed';
  error?: string;
}

export interface UploadSessionResponse {
  id: string;
  workspaceId: string;
  userId: string;
  status: UploadSessionStatus;
  files: Array<{
    index: number;
    filename: string;
    mimeType: string;
    size: number;
    documentId?: string;
    status: string;
    progress: number;
    error?: string;
  }>;
  totalFiles: number;
  totalSize: number;
  completedFiles: number;
  failedFiles: number;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface BulkUploadCompleteResponse {
  sessionId: string;
  status: 'success' | 'partial' | 'failed';
  totalFiles: number;
  successful: {
    count: number;
    documents: DocumentResponse[];
  };
  failed: {
    count: number;
    files: Array<{
      index: number;
      filename: string;
      error: string;
    }>;
  };
  duration: number;
}

export interface UploadProgressNotification {
  eventType: 'upload_progress' | 'upload_complete' | 'upload_failed';
  sessionId: string;
  fileIndex?: number;
  filename?: string;
  progress?: number;
  document?: DocumentResponse;
  error?: string;
  summary?: {
    total: number;
    successful: number;
    failed: number;
  };
}
