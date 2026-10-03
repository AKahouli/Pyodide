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
      void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.reviewQueue(modelId) });
    },
  });
}

/**
 * Repopulates the model from scratch: the runtime clears every record, link and review item earlier runs
 * made, then reads every source again. The model's settings are left as they are.
 */
export function useRebuildFromScratch(modelId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (options: { forgetDocumentReading: boolean }) => semanticModelApi.rebuildPopulation(modelId ?? '', options),
    onSuccess: () => {
      if (!modelId) return;
      // Drop, not just invalidate: the data these were showing no longer exists.
      queryClient.removeQueries({ queryKey: ['semantic-models', 'data-preview', modelId] });
      queryClient.removeQueries({ queryKey: ['semantic-models', 'concept-records', modelId] });
      for (const key of [semanticModelQueryKeys.readiness(modelId), semanticModelQueryKeys.reviewQueue(modelId), semanticModelQueryKeys.freshness(modelId)]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    },
  });
}
