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
  // Kept for logging/observability — the upstream endpoint no longer uses
  // (workspaceId, documentId) to locate the index entry.
  documentId: string;
  workspaceId: string;
  // Fields actually sent to the indexing API. Symmetric with what
  // IndexDocumentRequest provides — workspaceName mirrors workspace.storagePrefix
  // (the immutable second path segment), filePath is the full Ceph object key
  // (document.path), and fileName is the sanitised stored filename
  // (document.filename — last segment of the path).
  workspaceName: string;
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

export interface IndexingClient {
  indexDocument(document: IndexDocumentRequest): Promise<IndexDocumentResponse>;
  getIndexStatus(documentId: string): Promise<IndexStatus>;
  deleteIndex(request: DeleteIndexRequest): Promise<DeleteIndexResponse>;
}
