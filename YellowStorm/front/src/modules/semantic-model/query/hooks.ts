import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { semanticModelApi } from '../api';
import { semanticModelQueryKeys } from './queryKeys';

export function useSemanticModels(filters: Record<string, string | number | undefined>) {
  return useQuery({ queryKey: semanticModelQueryKeys.catalog(filters), queryFn: () => semanticModelApi.list(filters) });
}
export function useSemanticModel(id: string | undefined) {
  return useQuery({ queryKey: semanticModelQueryKeys.model(id ?? 'none'), queryFn: () => semanticModelApi.get(id ?? ''), enabled: Boolean(id) });
}
export function useSemanticGraph(id: string | undefined) {
  return useQuery({ queryKey: semanticModelQueryKeys.graph(id ?? 'none'), queryFn: () => semanticModelApi.graph(id ?? ''), enabled: Boolean(id) });
}
export function useSemanticBindings(id: string | undefined) {
  return useQuery({ queryKey: semanticModelQueryKeys.bindings(id ?? 'none'), queryFn: () => semanticModelApi.bindings(id ?? ''), enabled: Boolean(id) });
}
export function useSemanticWorkspaces(id: string | undefined) {
  return useQuery({ queryKey: semanticModelQueryKeys.workspaces(id ?? 'none'), queryFn: () => semanticModelApi.workspaces(id ?? ''), enabled: Boolean(id) });
}
export function useSemanticVersions(id: string | undefined) {
  return useQuery({ queryKey: semanticModelQueryKeys.versions(id ?? 'none'), queryFn: () => semanticModelApi.versions(id ?? ''), enabled: Boolean(id) });
}
export function useCreateSemanticModel() {
  const client = useQueryClient();
  return useMutation({ mutationFn: semanticModelApi.create, onSuccess: () => client.invalidateQueries({ queryKey: semanticModelQueryKeys.all }) });
}
export function useSourceAssets(id: string | undefined) {
  return useQuery({ queryKey: semanticModelQueryKeys.sourceAssets(id ?? 'none'), queryFn: () => semanticModelApi.listSourceAssets(id ?? ''), enabled: Boolean(id) });
}
export function useSourceMappings(id: string | undefined) {
  return useQuery({ queryKey: semanticModelQueryKeys.sourceMappings(id ?? 'none'), queryFn: () => semanticModelApi.listSourceMappings(id ?? ''), enabled: Boolean(id) });
}
export function useRelationResolutionRules(id: string | undefined) {
  return useQuery({ queryKey: semanticModelQueryKeys.relationRules(id ?? 'none'), queryFn: () => semanticModelApi.listRelationResolutionRules(id ?? ''), enabled: Boolean(id) });
}
export function useIdentityRules(id: string | undefined) {
  return useQuery({ queryKey: semanticModelQueryKeys.identityRules(id ?? 'none'), queryFn: () => semanticModelApi.listIdentityRules(id ?? ''), enabled: Boolean(id) });
}

export function useSourceResolutionPolicies(id: string | undefined) {
  return useQuery({ queryKey: semanticModelQueryKeys.sourcePolicies(id ?? 'none'), queryFn: () => semanticModelApi.listSourceResolutionPolicies(id ?? ''), enabled: Boolean(id) });
}
export function useSemanticDataPreview(id: string | undefined, limit: number, enabled = true, dataRevisionId?: string) {
  return useQuery({
    queryKey: [...semanticModelQueryKeys.dataPreview(id ?? 'none', limit), dataRevisionId ?? 'active'],
    queryFn: () => semanticModelApi.dataPreview(id ?? '', { limit, dataRevisionId }),
    enabled: Boolean(id) && enabled,
    staleTime: 60_000,
    retry: false,
  });
}
export function useMappingHealth(id: string | undefined) {
  return useQuery({ queryKey: semanticModelQueryKeys.mappingHealth(id ?? 'none'), queryFn: () => semanticModelApi.mappingHealth(id ?? ''), enabled: Boolean(id), staleTime: 60_000, retry: false });
}
export function useSemanticReadiness(id: string | undefined) {
  return useQuery({ queryKey: semanticModelQueryKeys.readiness(id ?? 'none'), queryFn: () => semanticModelApi.readiness(id ?? ''), enabled: Boolean(id) });
}
export function useVersionComparison(id: string | undefined, left: string | undefined, right: string | undefined) {
  return useQuery({
    queryKey: ['semantic-models', 'version-compare', id ?? 'none', left ?? 'none', right ?? 'none'],
    queryFn: () => semanticModelApi.compareVersions(id ?? '', left ?? '', right ?? ''),
    enabled: Boolean(id && left && right && left !== right),
    retry: false,
  });
}
export function useReviewQueue(id: string | undefined, enabled = true) {
  return useQuery({ queryKey: semanticModelQueryKeys.reviewQueue(id ?? 'none'), queryFn: () => semanticModelApi.reviewQueue(id ?? ''), enabled: Boolean(id) && enabled, retry: false, staleTime: 30_000 });
}

/** Whether the data in use matches the model as it is now; re-asked whenever the model's queries are refreshed. */
export function usePopulationFreshness(id: string | undefined, enabled = true) {
  return useQuery({ queryKey: semanticModelQueryKeys.freshness(id ?? 'none'), queryFn: () => semanticModelApi.populationFreshness(id ?? ''), enabled: Boolean(id) && enabled, staleTime: 5_000 });
}
export function useCanvasPositions(id: string | undefined) {
  return useQuery({ queryKey: semanticModelQueryKeys.canvasPositions(id ?? 'none'), queryFn: () => semanticModelApi.canvasPositions(id ?? ''), enabled: Boolean(id) });
}
