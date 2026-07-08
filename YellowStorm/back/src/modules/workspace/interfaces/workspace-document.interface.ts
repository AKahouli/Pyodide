import { DocumentStatus, DocumentType, IndexingStatus } from '../schemas/workspace-document.schema';

export interface RequestUploadUrlData {
  filename: string;
  mimeType: string;
  size: number;
}

export interface UploadUrlResponse {
  documentId: string;
  uploadUrl: string;
  expiresAt: string;
}

export interface ConfirmUploadData {
  documentId: string;
}

export interface DocumentQueryParams {
  page?: number;
  limit?: number;
  status?: DocumentStatus;
  search?: string;
  sortBy?: 'originalName' | 'createdAt' | 'size';
  sortOrder?: 'asc' | 'desc';
  parentId?: string | null;
}

export interface DocumentResponse {
  id: string;
  filename?: string;
  originalName: string;
  mimeType: string;
  size: number;
  path?: string;
  url?: string; // Optional for pending documents
  contentHash?: string;
  workspaceId: string;
  createdBy: string;
  status: DocumentStatus;
  uploadedAt?: string;
  errorMessage?: string;
  metadata?: Record<string, string>;
  indexingStatus: IndexingStatus;
  indexingError?: string;
  indexingTaskName?: string;
  indexingTaskId?: string;
  lastIndexedAt?: string;
  detected_language?: string;
  chunk_size?: number;
  parentId?: string;
  isFolder: boolean;
  folderName?: string;
  type: DocumentType;
  sourceUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface PaginatedDocuments {
  documents: DocumentResponse[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface DownloadUrlResponse {
  url: string;
  expiresAt: string;
}

export interface BulkDeleteResult {
  deleted: number;
  failed: string[];
}
