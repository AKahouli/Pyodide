// Curated semantic_api read contracts (hand-written against
// deploy/data-plane/sql/001_curated_api.sql; CLI generation follows in 2C
// hardening). Only exposed display fields — never internal assertions.

// P2.SB18: generate from the curated schema only. This file mirrors
// semantic_api.model_summary until CLI generation lands.
export interface SemanticModelSummaryRow {
  model_id: string;
  name: string;
  status: string;
  revision: number;
  active_data_revision: number | null;
  updated_at: string;
}

export interface SemanticSourceSummaryRow {
  mapping_id: string;
  model_id: string;
  workspace_id: string;
  document_id: string;
  sheet_name: string;
  asset_kind: string;
  mapping_status: string;
  source_revision: number | null;
  event_type: string | null;
  deleted: boolean | null;
  occurred_at: string | null;
  original_name: string | null;
  mime_type: string | null;
  document_status: string | null;
  indexing_status: string | null;
}

export interface SemanticDataTokenResponse {
  capabilities: { dataApi: boolean; realtime: boolean };
  token: string | null;
  realtimeToken: string | null;
  topic: string | null;
  restUrl: string | null;
  realtimeUrl: string | null;
  expiresAt: string | null;
}

export type EnabledSemanticDataGrant = SemanticDataTokenResponse & {
  capabilities: { dataApi: true; realtime: boolean };
  token: string;
  restUrl: string;
  expiresAt: string;
};

export type SemanticBroadcastEvent =
  | 'data-revision-changed'
  | 'datasource-status-changed'
  | 'review-items-changed'
  | 'population-status-changed'
  | 'model-read-state-changed';

export interface SemanticBroadcastPayload {
  modelId: string;
  dataRevision?: number;
  resource?: string;
  status?: string;
  reason?: string;
}

// Bounded list contract shared by curated reads.
export const DATA_PAGE_DEFAULT = 50;
export const DATA_PAGE_MAX = 200;
