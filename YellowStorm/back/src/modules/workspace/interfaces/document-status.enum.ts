/**
 * Document lifecycle statuses, moved out of workspace-document.schema.ts so
 * consumers can import the enum without pulling Mongoose schema definitions
 * into their module graph (Step C.8).
 */
export enum DocumentStatus {
  PENDING = 'pending',
  UPLOADING = 'uploading',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

export enum IndexingStatus {
  NONE = 'none',
  PENDING = 'pending',
  PROCESSING = 'processing',
  READY = 'ready',
  FAILED = 'failed',
}

export enum DocumentType {
  DOC = 'doc',
  URL = 'url',
}
