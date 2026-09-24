import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { semanticModelApi } from '../api';
import { semanticModelQueryKeys } from './queryKeys';

export function useSemanticModels(filters: Record<string, string | number | undefined>) {
  return useQuery({ queryKey: semanticModelQueryKeys.catalog(filters), queryFn: () => semanticModelApi.list(filters), refetchInterval: (query) => query.state.data?.items.some((model) => model.indexStatus === 'pending' || model.indexStatus === 'in_progress') ? 3000 : false });
}
export function useSemanticModel(id: string | undefined) {
  return useQuery({ queryKey: semanticModelQueryKeys.model(id ?? 'none'), queryFn: () => semanticModelApi.get(id ?? ''), enabled: Boolean(id), refetchInterval: (query) => ['pending','in_progress'].includes(query.state.data?.indexStatus ?? '') ? 3000 : false });
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
export function useSourceResolutionPolicies(id: string | undefined) {
  return useQuery({ queryKey: semanticModelQueryKeys.sourcePolicies(id ?? 'none'), queryFn: () => semanticModelApi.listSourceResolutionPolicies(id ?? ''), enabled: Boolean(id) });
}
export function useSemanticDataPreview(id: string | undefined, limit: number, enabled = true) {
  return useQuery({
    queryKey: semanticModelQueryKeys.dataPreview(id ?? 'none', limit),
    queryFn: () => semanticModelApi.dataPreview(id ?? '', { limit }),
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
export function useSemanticReviewItems(id: string | undefined, status: 'open' | 'resolved' = 'open', enabled = true) {
  return useQuery({ queryKey: semanticModelQueryKeys.reviewItems(id ?? 'none', status), queryFn: () => semanticModelApi.reviewItems(id ?? '', status), enabled: Boolean(id) && enabled });
}
