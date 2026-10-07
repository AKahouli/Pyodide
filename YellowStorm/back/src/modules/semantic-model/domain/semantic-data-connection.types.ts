/** The kinds of data source a model can be connected to. SQL databases come next. */
export const DATA_CONNECTION_KINDS = ['mail_archive'] as const;
export type DataConnectionKind = (typeof DATA_CONNECTION_KINDS)[number];

/** A .zip of .eml files, or one .eml: the runtime reads it as the messages, participants and attachments tables. */
export const MAIL_ARCHIVE_MIME_TYPES = ['application/zip', 'application/x-zip-compressed', 'message/rfc822'];

export function isMailArchive(mimeType: string | undefined): boolean {
  return typeof mimeType === 'string' && MAIL_ARCHIVE_MIME_TYPES.some((prefix) => mimeType.startsWith(prefix));
}

export interface DataConnection {
  id: string;
  kind: DataConnectionKind;
  name: string;
  workspaceId: string;
  documentId: string;
  /** Whether runs also copy the e-mails and attachments into the workspace to be indexed there; off by default. */
  indexInWorkspace: boolean;
  /** False when the file is gone or the person can no longer open its workspace. */
  available: boolean;
  createdAt: string;
}
