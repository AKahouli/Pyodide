/**
 * Indexing Service Interfaces
 */

export interface IndexDocumentRequest {
  // Document data
  documentId: string;
  workspaceId: string;
  filename?: string;
  mimeType: string;
  path?: string;      // S3 object key in Ceph (optional for folders)
  size: number;
  blobUrl?: string;   // canonical S3 object URL (unsigned) used as the "source" field

  // Ceph location parts — `indexDocumentFromCephStore` requires these in
  // addition to `filepath`/`source` so it can locate the object by its
  // (workspace_name, file_name) pair. These mirror what's actually in the
  // object key: workspaceName = workspace.storagePrefix (immutable, matches
  // the second path segment), fileName = document.filename (sanitised stored
  // name, the last path segment).
  workspaceName: string;
  fileName: string;

  // Workspace settings
  chunkSize: number;          // from workspace settings `chunks` (default 4000)
  enableSmartChunk: boolean;  // from workspace settings `hybridSearch` (default false)
  oneshotPrompt?: string;     // from workspace settings `instruction`
  brainTag?: string;          // from workspace settings `tag`
  user_id: string;            // for logging and passing to indexing API for enrichment
  deepSearch?: boolean;       // when true, sends document to community-graph for deep research ingestion
}

export interface IndexDocumentResponse {
  download_id: string;
  indexing_id: string;
}

export interface DeleteIndexRequest {
  // documentId is retained for logging; the API identifies files by workspace ID and location.
  documentId: string;
  workspaceId: string;
  // Full Ceph object key and sanitised stored filename.
  filePath: string;
  fileName: string;
}

export interface DeleteIndexResponse {
  success: boolean;
  error?: string;
}

export interface IndexStatus {
  status: 'pending' | 'processing' | 'ready' | 'failed';
  error?: string;
  processedAt?: Date;
}

/** The schedule is supplied by the indexing provider, never inferred from file type. */
export interface IndexingProgress {
  currentStep: number;
  totalSteps: number;
  steps: { number: number; name: string; key: string; task_id: string }[];
  stepStatus?: 'PROCESSING' | 'FINISH' | 'FAIL';
  processingStatus?: string;
  processingTaskName?: string;
  processingTaskKey?: string;
  processingTaskId?: string;
  message?: string;
}

export function readIndexingProgress(metadata?: Record<string, string>): IndexingProgress | undefined {
  const value = metadata?.indexingProgress;
  if (!value) return undefined;
  // Written only by the validated indexing webhook; empty string resets a retry.
  return JSON.parse(value) as IndexingProgress;
}

export interface IndexingClient {
  indexDocument(document: IndexDocumentRequest): Promise<IndexDocumentResponse>;
  getIndexStatus(documentId: string): Promise<IndexStatus>;
  deleteIndex(request: DeleteIndexRequest): Promise<DeleteIndexResponse>;
}
