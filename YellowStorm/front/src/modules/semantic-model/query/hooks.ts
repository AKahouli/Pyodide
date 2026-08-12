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
