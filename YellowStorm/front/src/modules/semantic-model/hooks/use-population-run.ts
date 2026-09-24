import { useMutation, useQueryClient } from '@tanstack/react-query';
import { semanticModelApi } from '../api';
import { semanticModelQueryKeys } from '../query/queryKeys';

/**
 * Asks the semantic-model runtime to read the model's sources and populate it.
 *
 * This is the supported path: population reads the logical index through the read-only
 * adapter. It replaces the retired evidence-search/native-search pipeline, which failed
 * for every source once that service was decommissioned.
 */
export function usePopulationRun(modelId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scope: { kind: 'model' } | { kind: 'mapping'; mappingId: string } = { kind: 'model' }) =>
      semanticModelApi.requestPopulationRefresh(modelId ?? '', { purpose: 'build', scope }),
    onSuccess: () => {
      if (!modelId) return;
      // The run is asynchronous and there is no progress endpoint yet, so refresh what the
      // page can already show: records land on the graph, ambiguities land in the review queue.
      void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.graph(modelId) });
      void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.readiness(modelId) });
      void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.reviewItems(modelId, 'open') });
    },
  });
}
