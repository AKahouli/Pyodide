// Bounded typed reads over the curated PostgREST schema (P2.SB19).
// Explicit column lists, hard row caps, no select('*') on evidence DTOs.
// Commands stay on the NestJS/OpenAPI clients; this module never writes.
import { PostgrestClient } from '@supabase/postgrest-js';
import { getDataGrant } from './data-access-token';
import { DATA_PAGE_DEFAULT, type SemanticModelSummaryRow } from './semantic-api.types';

export interface DatabaseShape {
  semantic_api: {
    Tables: {
      model_summary: {
        Row: SemanticModelSummaryRow;
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
  const { data, error } = await client
    .from('model_summary')
    .select('model_id,name,status,revision,updated_at')
    .eq('model_id', modelId)
    .limit(DATA_PAGE_DEFAULT);
  if (error) throw new Error(`model summary read failed: ${error.message}`);
  return data ?? [];
}
