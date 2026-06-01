import { useQuery } from '@tanstack/react-query';
import { getHitlBlockers, getHitlMemories, getHitlPolicy, getNodeHitlPolicy } from '@/modules/playbook/api';
import { playbookKeys } from '@/modules/playbook/query/queryKeys';

/** Reads server-owned HITL policy and blocker catalogs through Query so editor UI does not duplicate server state in Zustand. */
export function useHitlPolicyQuery(flowId: string | null | undefined, nodeId?: string | null) {
  return useQuery({
    queryKey: playbookKeys.hitlPolicy(flowId ?? '', nodeId),
    queryFn: () => nodeId ? getNodeHitlPolicy(flowId as string, nodeId) : getHitlPolicy(flowId as string),
    enabled: Boolean(flowId),
  });
}

export function useHitlBlockersQuery(flowId: string | null | undefined) {
  return useQuery({
    queryKey: playbookKeys.hitlBlockers(flowId ?? ''),
    queryFn: () => getHitlBlockers(flowId as string),
    enabled: Boolean(flowId),
  });
}

export function useHitlMemoriesQuery(flowId: string | null | undefined) {
  return useQuery({
    queryKey: playbookKeys.hitlMemories(flowId ?? ''),
    queryFn: () => getHitlMemories(flowId as string),
    enabled: Boolean(flowId),
  });
}
