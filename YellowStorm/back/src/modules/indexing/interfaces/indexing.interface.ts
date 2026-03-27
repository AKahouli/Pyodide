/**
 * Indexing Service Interfaces
 */

export interface IndexDocumentRequest {
  // Document data
  documentId: string;
  workspaceId: string;
  filename: string;
  mimeType: string;
  path: string;      // blob path in Azure
  size: number;
  blobUrl: string;   // full blob URL without SAS token (for "source" field)

  // Workspace settings
  chunkSize: number;          // from workspace settings `chunks` (default 4000)
  enableSmartChunk: boolean;  // from workspace settings `hybridSearch` (default false)
  oneshotPrompt?: string;     // from workspace settings `instruction`
  brainTag?: string;          // from workspace settings `tag`
}

export interface IndexDocumentResponse {
  download_id: string;
  indexing_id: string;
}

export interface DeleteIndexRequest {
  documentId: string;
  workspaceId: string;
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
  getIndexStatus(externalId: string): Promise<IndexStatus>;
  deleteIndex(request: DeleteIndexRequest): Promise<DeleteIndexResponse>;
}
