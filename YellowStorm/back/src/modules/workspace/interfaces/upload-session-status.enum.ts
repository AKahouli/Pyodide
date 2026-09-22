/**
 * Upload-session lifecycle statuses (moved out of upload-session.schema.ts at
 * the D.10 cutover so consumers don't pull Mongoose schema definitions).
 */
export enum UploadSessionStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  EXPIRED = 'expired',
  FAILED = 'failed',
}
