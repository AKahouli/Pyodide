export type FlowMailEventLedgerStatus =
  | 'received'
  | 'normalized'
  | 'matched'
  | 'deduplicated'
  | 'ignored'
  | 'errored'
  | 'handed_off';

export interface FlowMailSenderData {
  name: string | null;
  address: string;
}

export interface FlowMailAttachmentWorkspaceImport {
  workspaceDocumentId: string | null;
  filename: string;
  finalFilename: string | null;
  mimeType: string | null;
  size: number | null;
  sourcePath: string | null;
  collisionResolved: boolean;
  error: string | null;
}

export interface FlowMailMessageAttachmentData {
  providerAttachmentId: string;
  filename: string;
  mimeType: string | null;
  size: number | null;
  isInline: boolean;
  workspaceImport: FlowMailAttachmentWorkspaceImport | null;
}

export interface FlowNormalizedMailEventData {
  provider: 'm365';
  mailboxAppKey: string;
  providerMessageId: string;
  providerThreadId: string | null;
  receivedAt: string;
  occurredAt: string;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  from: FlowMailSenderData;
  to: FlowMailSenderData[];
  cc: FlowMailSenderData[];
  hasAttachments: boolean;
  attachments: FlowMailMessageAttachmentData[];
}

export interface FlowMailTriggerFiltersData {
  from: string[];
  subjectContains: string[];
  bodyContains: string[];
  hasAttachments: boolean | null;
}

export interface FlowMailEventLedgerEntryData {
  id: string;
  dedupeKey: string;
  status: FlowMailEventLedgerStatus;
  event: FlowNormalizedMailEventData;
  error: string | null;
  createdAt: string;
}

export interface FlowMailEventIngestionResultData {
  duplicate: boolean;
  entry: FlowMailEventLedgerEntryData;
}

export interface FlowMailTriggerMatchResultData {
  matched: boolean;
  reasons: string[];
}

export interface FlowMailTriggerEvaluationResultData {
  ingestion: FlowMailEventIngestionResultData;
  match: FlowMailTriggerMatchResultData;
  finalStatus: FlowMailEventLedgerStatus;
}

export interface FlowMailTriggerHandoffResultData {
  executionId: string | null;
  handedOff: boolean;
  skippedReason: 'duplicate' | 'not-matched' | 'already-handed-off' | null;
}
