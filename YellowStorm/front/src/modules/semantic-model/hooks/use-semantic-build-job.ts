import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { semanticModelApi } from '../api';
import { semanticModelQueryKeys } from '../query/queryKeys';
import type { SemanticBuildApplyMode, SemanticBuildJob, SemanticModelManualInstances } from '../types';

const BUILD_POLL_INTERVAL_MS = 3_000;

/**
 * Polls the latest build for a semantic model.
 *
 * The banner UI subscribes to this hook. When a build reaches a terminal state
 * (completed / failed) the polling stops automatically and the graph query is
 * invalidated so the canvas refreshes without a page reload.
 */
export function useSemanticBuildJob(modelId: string | undefined) {
  const queryClient = useQueryClient();
  const previousStatusRef = useRef<SemanticBuildJob['status'] | null>(null);

  const query = useQuery({
    queryKey: semanticModelBuildQueryKey(modelId),
    queryFn: () => semanticModelApi.getLatestBuild(modelId ?? ''),
    enabled: Boolean(modelId),
    refetchInterval: (query) => {
      const data = query.state.data as SemanticBuildJob | null | undefined;
      return data?.status === 'running' ? BUILD_POLL_INTERVAL_MS : false;
    },
    refetchIntervalInBackground: true,
  });

  // When status transitions to 'completed' → invalidate the graph so the canvas re-renders.
  useEffect(() => {
    if (!modelId) return;
    const status = query.data?.status ?? null;
    const previous = previousStatusRef.current;
    previousStatusRef.current = status;
    if (previous === 'running' && status === 'completed') {
      void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.graph(modelId) });
      void queryClient.invalidateQueries({ queryKey: semanticModelQueryKeys.model(modelId) });
    }
  }, [modelId, query.data?.status, queryClient]);

  return query;
}

export function useStartSemanticBuild(modelId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      businessRequirements,
      applyMode,
      manualInstances,
    }: {
      businessRequirements: string[];
      applyMode?: SemanticBuildApplyMode;
      manualInstances?: SemanticModelManualInstances[];
    }) => semanticModelApi.startBuild(modelId ?? '', businessRequirements, applyMode ?? 'replace', manualInstances ?? []),
    onSuccess: () => {
      if (!modelId) return;
      // Refetch the latest build immediately so the banner appears without waiting for the next poll.
      void queryClient.invalidateQueries({ queryKey: semanticModelBuildQueryKey(modelId) });
    },
  });
}

export function semanticModelBuildQueryKey(modelId: string | undefined) {
  return ['semantic-models', 'build-latest', modelId ?? 'none'] as const;
}

export function isBuildActive(job: SemanticBuildJob | null | undefined): boolean {
  return job?.status === 'running';
}
