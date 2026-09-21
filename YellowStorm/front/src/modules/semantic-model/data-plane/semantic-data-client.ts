// Bounded typed reads over the curated PostgREST schema (P2.SB19).
// Explicit column lists, hard row caps, no select('*') on evidence DTOs.
// Commands stay on the NestJS/OpenAPI clients; this module never writes.
import { PostgrestClient } from '@supabase/postgrest-js';
import { clearDataGrants, getDataGrant } from './data-access-token';
import { DATA_PAGE_DEFAULT, DATA_PAGE_MAX, type SemanticModelSummaryRow, type SemanticSourceSummaryRow } from './semantic-api.types';

export interface DatabaseShape {
  semantic_api: {
    Tables: {
      model_summary: {
        Row: SemanticModelSummaryRow;
      };
      source_summary: {
        Row: SemanticSourceSummaryRow;
      };
    };
  };
}

function scopedClient(restUrl: string, token: string) {
  // restUrl is the PostgREST base (direct or gateway-stripped); no version suffix here.
  return new PostgrestClient<DatabaseShape>(restUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Model catalog summary for one model. Throws on auth/transport failure. */
export async function fetchModelSummary(modelId: string): Promise<SemanticModelSummaryRow[]> {
  const grant = await getDataGrant(modelId);
  const client = scopedClient(grant.restUrl, grant.token);
  const { data, error, status } = await client
    .from('model_summary')
    .select('model_id,name,status,revision,active_data_revision,updated_at')
    .eq('model_id', modelId)
    .limit(DATA_PAGE_DEFAULT);
  if (status === 401 || status === 403) clearDataGrants(modelId);
  if (error) throw new Error(`model summary read failed: ${error.message}`);
  return data ?? [];
}

/** Current status for the model's bounded mapped-source inventory. */
export async function fetchSourceSummary(modelId: string): Promise<SemanticSourceSummaryRow[]> {
  const grant = await getDataGrant(modelId);
  const client = scopedClient(grant.restUrl, grant.token);
  const { data, error, status } = await client
    .from('source_summary')
    .select('mapping_id,model_id,workspace_id,document_id,sheet_name,asset_kind,mapping_status,source_revision,event_type,deleted,occurred_at,original_name,mime_type,document_status,indexing_status')
    .eq('model_id', modelId)
    .order('original_name')
    .limit(DATA_PAGE_MAX);
  if (status === 401 || status === 403) clearDataGrants(modelId);
  if (error) throw new Error(`source summary read failed: ${error.message}`);
  return data ?? [];
}
