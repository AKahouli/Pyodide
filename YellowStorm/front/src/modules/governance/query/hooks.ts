import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { governanceApi } from '../api';
import { governanceQueryKeys } from './queryKeys';
import type { CreateGovernanceDeploymentPayload, CreateGovernanceDryRunPayload, CreateGovernanceMembershipPayload, CreateGovernanceProgramPayload, CreateGovernanceRevisionPayload, CreateGovernanceScopePayload, GovernanceDryRun, UpdateGovernanceDeploymentPayload, UpdateGovernanceMembershipPayload, UpdateGovernanceProgramPayload, UpdateGovernanceScopePayload } from '../types';

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

export function useGovernanceDocuments(programId: string | null) {
  return useQuery({
    queryKey: programId ? governanceQueryKeys.documents(programId) : governanceQueryKeys.documents('none'),
    queryFn: () => governanceApi.listDocuments(programId ?? ''),
    enabled: Boolean(programId),
  });
}

export function useGovernanceScopeOverview(programId: string | null, scopeId: string | null) {
  return useQuery({
    queryKey: programId && scopeId ? governanceQueryKeys.scopeOverview(programId, scopeId) : governanceQueryKeys.scopeOverview('none', 'none'),
    queryFn: () => governanceApi.getScopeOverview(programId ?? '', scopeId ?? ''),
    enabled: Boolean(programId && scopeId),
    staleTime: 30_000,
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

export function useUpdateGovernanceProgram(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateGovernanceProgramPayload) => governanceApi.updateProgram(programId ?? '', payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: governanceQueryKeys.programs() }),
  });
}

export function useDeleteGovernanceProgram() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (programId: string) => governanceApi.deleteProgram(programId),
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
      void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.availableScopes() });
    },
  });
}

export function useDeleteGovernanceScope(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (scopeId: string) => governanceApi.deleteScope(programId ?? '', scopeId),
    onSuccess: () => {
      if (programId) {
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.program(programId) });
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.scopes(programId) });
      }
    },
  });
}

export function useGovernanceScopeAudience(programId: string | null, scopeId: string | null) {
  return useQuery({
    queryKey: governanceQueryKeys.scopeAudience(programId ?? 'none', scopeId ?? 'none'),
    queryFn: () => governanceApi.getScopeAudience(programId ?? '', scopeId ?? ''),
    enabled: Boolean(programId && scopeId),
  });
}

export function useUpdateGovernanceScopeAudience(programId: string | null, scopeId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: Parameters<typeof governanceApi.updateScopeAudience>[2]) => governanceApi.updateScopeAudience(programId ?? '', scopeId ?? '', payload),
    onSuccess: async () => {
      if (programId && scopeId) await queryClient.invalidateQueries({ queryKey: governanceQueryKeys.scopeAudience(programId, scopeId) });
      if (programId && scopeId) await queryClient.invalidateQueries({ queryKey: governanceQueryKeys.scopeOverview(programId, scopeId) });
      await queryClient.invalidateQueries({ queryKey: governanceQueryKeys.availableScopes() });
    },
  });
}

export function useAvailableGovernedScopes(enabled = true) {
  return useQuery({ queryKey: governanceQueryKeys.availableScopes(), queryFn: governanceApi.listAvailableScopes, enabled, retry: 1 });
}

export function useGovernanceDocumentEvents(programId: string | null, documentId: string | null) {
  return useQuery({ queryKey: governanceQueryKeys.documentEvents(programId ?? 'none', documentId ?? 'none'), queryFn: () => governanceApi.listDocumentEvents(programId ?? '', documentId ?? ''), enabled: Boolean(programId && documentId) });
}

export function useGovernanceWorkspaceBindings(programId: string | null) {
  return useQuery({ queryKey: governanceQueryKeys.workspaceBindings(programId ?? 'none'), queryFn: () => governanceApi.listWorkspaceBindings(programId ?? ''), enabled: Boolean(programId) });
}

export function useCreateGovernanceDocument(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (documentId: string) => governanceApi.createDocumentGovernance(programId ?? '', documentId),
    onSuccess: () => { if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.documents(programId) }); },
  });
}

export function useCreateGovernanceWorkspaceBinding(programId: string | null, scopeId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: import('../types').CreateGovernanceWorkspaceBindingPayload) => governanceApi.createWorkspaceBinding(programId ?? '', payload),
    onSuccess: () => { if (programId) { void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.scopeOverview(programId, scopeId) }); void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.workspaceBindings(programId) }); } },
  });
}

export function useUpdateGovernanceWorkspaceBinding(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ bindingId, payload }: { bindingId: string; payload: Parameters<typeof governanceApi.updateWorkspaceBinding>[2] }) => governanceApi.updateWorkspaceBinding(programId ?? '', bindingId, payload), onSuccess: () => { if (programId) { void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.workspaceBindings(programId) }); void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.scopes(programId) }); } } });
}

export function useDeleteGovernanceWorkspaceBinding(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (bindingId: string) => governanceApi.deleteWorkspaceBinding(programId ?? '', bindingId), onSuccess: () => { if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.all }); } });
}

export function useReconcileGovernanceWorkspaceBinding(programId: string | null) {
  return useMutation({ mutationFn: ({ bindingId, dryRun }: { bindingId: string; dryRun: boolean }) => governanceApi.reconcileWorkspaceBinding(programId ?? '', bindingId, dryRun) });
}

export function useCreateGovernanceReconciliationRun(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ bindingId, dryRun }: { bindingId: string; dryRun: boolean }) => governanceApi.createReconciliationRun(programId ?? '', bindingId, dryRun), onSuccess: (run) => { if (programId && !run.dryRun && run.status === 'completed') void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.program(programId) }); } });
}

export function useGovernanceReconciliationRun(programId: string | null, bindingId: string, runId: string | null) {
  return useQuery({ queryKey: governanceQueryKeys.reconciliationRun(programId ?? 'none', bindingId, runId ?? 'none'), queryFn: () => governanceApi.getReconciliationRun(programId ?? '', bindingId, runId ?? ''), enabled: Boolean(programId && runId), refetchInterval: (query) => query.state.data?.status === 'pending' || query.state.data?.status === 'running' ? 1_000 : false });
}

export function useResumeGovernanceReconciliationRun(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ bindingId, runId }: { bindingId: string; runId: string }) => governanceApi.resumeReconciliationRun(programId ?? '', bindingId, runId), onSuccess: (run, variables) => { if (programId) queryClient.setQueryData(governanceQueryKeys.reconciliationRun(programId, variables.bindingId, variables.runId), run); } });
}

export function useArchiveGovernanceDocument(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, expectedGovernanceRevision }: { documentId: string; expectedGovernanceRevision: number }) => governanceApi.archiveDocument(programId ?? '', documentId, expectedGovernanceRevision),
    onSuccess: () => {
      if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.all });
    },
  });
}

export function useCreateGovernanceMembership(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateGovernanceMembershipPayload) => governanceApi.createMembership(programId ?? '', payload),
    onSuccess: () => {
      if (programId) {
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.memberships(programId) });
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.scopes(programId) });
      }
    },
  });
}

export function useUpdateGovernanceMembership(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ membershipId, payload }: { membershipId: string; payload: UpdateGovernanceMembershipPayload }) => governanceApi.updateMembership(programId ?? '', membershipId, payload),
    onSuccess: () => {
      if (programId) {
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.memberships(programId) });
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.scopes(programId) });
      }
    },
  });
}

export function useDeleteGovernanceMembership(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (membershipId: string) => governanceApi.deleteMembership(programId ?? '', membershipId),
    onSuccess: () => {
      if (programId) {
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.memberships(programId) });
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.scopes(programId) });
      }
    },
  });
}

export function useCreateGovernanceDeployment(programId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateGovernanceDeploymentPayload) => governanceApi.createDeployment(programId ?? '', payload),
    onSuccess: (_deployment, payload) => {
      if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.deployments(programId) });
      if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.scopeOverview(programId, payload.scopeId) });
    },
  });
}

export function useKnowledgeHealth(programId: string | null, scopeId?: string) {
  return useQuery({ queryKey: governanceQueryKeys.knowledgeHealth(programId ?? 'none', scopeId), queryFn: () => governanceApi.getKnowledgeHealth(programId ?? '', scopeId), enabled: Boolean(programId) });
}

export function useKnowledgeAlerts(programId: string | null, scopeId?: string) {
  return useQuery({ queryKey: governanceQueryKeys.knowledgeAlerts(programId ?? 'none', scopeId), queryFn: () => governanceApi.listKnowledgeAlerts(programId ?? '', { scopeId }), enabled: Boolean(programId) });
}

export function useKnowledgeRecommendations(programId: string | null, scopeId?: string) {
  return useQuery({ queryKey: governanceQueryKeys.knowledgeRecommendations(programId ?? 'none', scopeId), queryFn: () => governanceApi.listKnowledgeRecommendations(programId ?? '', { scopeId }), enabled: Boolean(programId) });
}

export function useMetadataCandidates(programId: string | null, scopeId?: string) {
  return useQuery({ queryKey: governanceQueryKeys.metadataCandidates(programId ?? 'none', scopeId), queryFn: () => governanceApi.listMetadataCandidates(programId ?? '', { scopeId }), enabled: Boolean(programId) });
}

export function useRefreshKnowledge(programId: string | null, scopeId?: string) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: () => governanceApi.refreshKnowledge(programId ?? '', scopeId), onSuccess: () => { if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.knowledge(programId, scopeId) }); } });
}

export function useAcknowledgeKnowledgeAlert(programId: string | null, scopeId?: string) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (alertId: string) => governanceApi.acknowledgeKnowledgeAlert(programId ?? '', alertId), onSuccess: () => { if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.knowledge(programId, scopeId) }); } });
}

export function useDecideKnowledgeRecommendation(programId: string | null, scopeId?: string) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ id, action }: { id: string; action: 'accept' | 'reject' }) => governanceApi.decideKnowledgeRecommendation(programId ?? '', id, action), onSuccess: () => { if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.knowledge(programId, scopeId) }); } });
}

export function useApplyKnowledgeRecommendation(programId: string | null, scopeId?: string) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: (id: string) => governanceApi.applyKnowledgeRecommendation(programId ?? '', id), onSuccess: () => { if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.knowledge(programId, scopeId) }); } });
}

export function useDecideMetadataCandidate(programId: string | null, scopeId?: string) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: ({ id, action, acceptedValue }: { id: string; action: 'accept' | 'reject'; acceptedValue?: unknown }) => governanceApi.decideMetadataCandidate(programId ?? '', id, action, acceptedValue), onSuccess: () => { if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.knowledge(programId, scopeId) }); } });
}

export function useUpdateGovernanceDeployment(programId: string | null, deploymentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateGovernanceDeploymentPayload) => governanceApi.updateDeployment(deploymentId ?? '', payload),
    onSuccess: () => {
      if (programId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.program(programId) });
      void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.all });
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

export function useCreateGovernanceDryRun(deploymentId: string | null, programId?: string | null, scopeId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateGovernanceDryRunPayload) => governanceApi.createDryRun(deploymentId ?? '', payload),
    onSuccess: () => {
      if (deploymentId) {
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.dryRuns(deploymentId) });
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.readiness(deploymentId) });
      }
      if (programId && scopeId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.scopeOverview(programId, scopeId) });
    },
  });
}

export function useMarkGovernanceDryRun(deploymentId: string | null, programId?: string | null, scopeId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ dryRunId, status }: { dryRunId: string; status: GovernanceDryRun['status'] }) => governanceApi.markDryRun(dryRunId, status),
    onSuccess: () => {
      if (deploymentId) {
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.dryRuns(deploymentId) });
        void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.readiness(deploymentId) });
      }
      if (programId && scopeId) void queryClient.invalidateQueries({ queryKey: governanceQueryKeys.scopeOverview(programId, scopeId) });
    },
  });
}

export function usePublishGovernanceDeployment(deploymentId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => governanceApi.publishDeployment(deploymentId ?? ''),
    onSuccess: async () => {
      if (deploymentId) await queryClient.invalidateQueries({ queryKey: governanceQueryKeys.readiness(deploymentId) });
      await queryClient.invalidateQueries({ queryKey: governanceQueryKeys.all });
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
