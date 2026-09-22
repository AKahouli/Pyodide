import { useQuery } from '@tanstack/react-query';
import { fetchSourceSummary } from './semantic-data-client';
import { semanticDataKeys } from './semantic-query-keys';

export function useSemanticModelSources(modelId: string | undefined) {
  return useQuery({
    queryKey: semanticDataKeys.sources(modelId ?? 'none'),
    queryFn: () => fetchSourceSummary(modelId ?? ''),
    enabled: Boolean(modelId),
    staleTime: 30_000,
    retry: false,
  });
}
