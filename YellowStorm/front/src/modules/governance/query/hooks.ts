import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { governanceApi } from '../api';
import { governanceQueryKeys } from './queryKeys';
import type { CreateGovernanceDeploymentPayload, CreateGovernanceDryRunPayload, CreateGovernanceMembershipPayload, CreateGovernanceProgramPayload, CreateGovernanceRevisionPayload, CreateGovernanceScopePayload, CreateGovernanceSourcePayload, GovernanceDryRun, UpdateGovernanceScopePayload } from '../types';

export function useGovernancePrograms() {
  return useQuery({
    queryKey: governanceQueryKeys.programs(),
    queryFn: governanceApi.listPrograms,
  });
}

export function useGovernanceScopes(programId: string | null) {
  return useQuery({
    queryKey: programId ? governanceQueryKeys.scopes(programId) : governanceQueryKeys.scopes('none'),
    queryFn: () => governanceApi.listScopes(programId ?? ''),
    enabled: Boolean(programId),
  });
}

export function useGovernanceSources(programId: string | null) {
  return useQuery({
    queryKey: programId ? governanceQueryKeys.sources(programId) : governanceQueryKeys.sources('none'),
    queryFn: () => governanceApi.listSources(programId ?? ''),
    enabled: Boolean(programId),
  });
}

export function useGovernanceScopeOverview(programId: string | null, scopeId: string | null) {
  return useQuery({
    queryKey: programId && scopeId ? governanceQueryKeys.scopeOverview(programId, scopeId) : governanceQueryKeys.scopeOverview('none', 'none'),
    queryFn: () => governanceApi.getScopeOverview(programId ?? '', scopeId ?? ''),
    enabled: Boolean(programId && scopeId),
  });
}

export function useGovernanceScopeOverviews(programId: string | null, scopeIds: string[]) {
  return useQueries({
    queries: scopeIds.map((scopeId) => ({
      queryKey: programId ? governanceQueryKeys.scopeOverview(programId, scopeId) : governanceQueryKeys.scopeOverview('none', scopeId),
      queryFn: () => governanceApi.getScopeOverview(programId ?? '', scopeId),
      enabled: Boolean(programId && scopeId),
    })),
    combine: (results) => ({
      byScopeId: Object.fromEntries(scopeIds.map((scopeId, index) => [scopeId, results[index]?.data])),
      isLoading: results.some((result) => result.isLoading),
    }),
  });
}

export function useGovernanceMemberships(programId: string | null) {
  return useQuery({
    queryKey: programId ? governanceQueryKeys.memberships(programId) : governanceQueryKeys.memberships('none'),
    queryFn: () => governanceApi.listMemberships(programId ?? ''),
    enabled: Boolean(programId),
  });
}

export function useGovernanceDeployments(programId: string | null) {
  return useQuery({
    queryKey: programId ? governanceQueryKeys.deployments(programId) : governanceQueryKeys.deployments('none'),
    queryFn: () => governanceApi.listDeployments(programId ?? ''),
    enabled: Boolean(programId),
  });
}

export function useGovernanceRevisions(deploymentId: string | null) {
  return useQuery({
    queryKey: deploymentId ? governanceQueryKeys.revisions(deploymentId) : governanceQueryKeys.revisions('none'),
    queryFn: () => governanceApi.listRevisions(deploymentId ?? ''),
    enabled: Boolean(deploymentId),
  });
}

export function useGovernanceDryRuns(deploymentId: string | null) {
  return useQuery({
    queryKey: deploymentId ? governanceQueryKeys.dryRuns(deploymentId) : governanceQueryKeys.dryRuns('none'),
    queryFn: () => governanceApi.listDryRuns(deploymentId ?? ''),
    enabled: Boolean(deploymentId),
  });
}

export function useGovernanceReadiness(deploymentId: string | null) {
  return useQuery({
    queryKey: deploymentId ? governanceQueryKeys.readiness(deploymentId) : governanceQueryKeys.readiness('none'),
    queryFn: () => governanceApi.getReadiness(deploymentId ?? ''),
    enabled: Boolean(deploymentId),
  });
}

export function useGovernanceMetrics(programId: string | null) {
  return useQuery({
    queryKey: programId ? governanceQueryKeys.metrics(programId) : governanceQueryKeys.metrics('none'),
    queryFn: () => governanceApi.listMetrics(programId ?? ''),
    enabled: Boolean(programId),
  });
}

export function useCreateGovernanceProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateGovernanceProgramPayload) => governanceApi.createProgram(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: governanceQueryKeys.programs() }),
  });
}

export function useCreateGovernanceScope(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateGovernanceScopePayload) => governanceApi.createScope(programId ?? '', payload),
    onSuccess: () => {
      if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.scopes(programId) });
    },
  });
}

export function useUpdateGovernanceScope(programId: string | null, scopeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateGovernanceScopePayload) => governanceApi.updateScope(programId ?? '', scopeId ?? '', payload),
    onSuccess: () => {
      if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.scopes(programId) });
      if (programId && scopeId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.scopeOverview(programId, scopeId) });
    },
  });
}

export function useCreateGovernanceSource(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateGovernanceSourcePayload) => governanceApi.createSource(programId ?? '', payload),
    onSuccess: () => {
      if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.program(programId) });
    },
  });
}

export function useCreateGovernanceMembership(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateGovernanceMembershipPayload) => governanceApi.createMembership(programId ?? '', payload),
    onSuccess: () => {
      if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.memberships(programId) });
    },
  });
}

export function useDeleteGovernanceMembership(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) => governanceApi.deleteMembership(programId ?? '', membershipId),
    onSuccess: () => {
      if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.memberships(programId) });
    },
  });
}

export function useCreateGovernanceDeployment(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateGovernanceDeploymentPayload) => governanceApi.createDeployment(programId ?? '', payload),
    onSuccess: () => {
      if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.deployments(programId) });
      if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.program(programId) });
    },
  });
}

export function useCreateGovernanceRevision(deploymentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateGovernanceRevisionPayload) => governanceApi.createRevision(deploymentId ?? '', payload),
    onSuccess: () => {
      if (deploymentId) {
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.deployment(deploymentId) });
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.revisions(deploymentId) });
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.all });
      }
    },
  });
}

export function useCreateGovernanceDryRun(deploymentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateGovernanceDryRunPayload) => governanceApi.createDryRun(deploymentId ?? '', payload),
    onSuccess: () => {
      if (deploymentId) {
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.dryRuns(deploymentId) });
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.all });
      }
    },
  });
}

export function useMarkGovernanceDryRun(deploymentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ dryRunId, status }: { dryRunId: string; status: GovernanceDryRun['status'] }) => governanceApi.markDryRun(dryRunId, status),
    onSuccess: () => {
      if (deploymentId) {
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.dryRuns(deploymentId) });
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.all });
      }
    },
  });
}

export function usePublishGovernanceDeployment(deploymentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => governanceApi.publishDeployment(deploymentId ?? ''),
    onSuccess: () => {
      if (deploymentId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.readiness(deploymentId) });
      void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.all });
    },
  });
}

export function useSuspendGovernanceDeployment(deploymentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => governanceApi.suspendDeployment(deploymentId ?? ''),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.all }),
  });
}
