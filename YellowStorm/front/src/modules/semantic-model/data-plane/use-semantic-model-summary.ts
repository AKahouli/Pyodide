// Bounded curated read: model summary via PostgREST (P2.SB19).
// Feature-flagged at the call site; falls back to useSemanticReadiness.
import { useQuery } from '@tanstack/react-query';
import { fetchModelSummary } from './semantic-data-client';
import { semanticDataKeys } from './semantic-query-keys';

export function useSemanticModelSummary(modelId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: semanticDataKeys.summary(modelId ?? 'none'),
    queryFn: () => fetchModelSummary(modelId ?? ''),
    enabled: Boolean(modelId) && enabled,
    staleTime: 30_000,
    retry: false,
  });
}
