/** How a conversation attachment may be consumed by agents. */
export type ConversationAttachmentPolicy = 'SEARCHABLE' | 'TEXT_ONLY' | 'CODE_ONLY';

export const ATTACHMENT_POLICY_METADATA_KEY = 'attachmentPolicy';
export const ATTACHMENT_PROFILE_PATH_METADATA_KEY = 'attachmentProfilePath';

/** AttachmentTextProfileV1 — written by the ADK attachment-profile service, stored as a Ceph sidecar. */
export interface AttachmentTextProfileV1 {
  version: 1;

  documentId: string;
  filename: string;
  mimeType: string;

  extraction: {
    status: 'ready' | 'partial' | 'failed';
    extractor: string;
    characters: number;
    truncated: boolean;
  };

  tabular?: {
    totalRows: number;
    sheetCount?: number;
    columnNames?: string[];
  };

  /** Bounded extracted text; CODE_ONLY profiles never carry content. */
  content?: string;
  preview?: string;

  generatedAt: string;
}

/** Result of preparing an attachment: the policy decision plus the loaded profile. */
export interface PreparedConversationAttachment {
  documentId: string;
  workspaceId: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;

  policy: ConversationAttachmentPolicy;

  rowCount?: number;
  sheetCount?: number;

  profilePath?: string;
  searchIndexAllowed: boolean;

  profile?: AttachmentTextProfileV1;
}
