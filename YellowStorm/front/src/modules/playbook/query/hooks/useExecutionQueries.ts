import { useQuery } from '@tanstack/react-query';

import { playbookFeatures } from '@/modules/playbook/features';
import {
  getActiveExecutions,
  getFlowExecutionDetail,
  getFlowExecutions,
} from '@/modules/playbook/api';
import { playbookKeys } from '@/modules/playbook/query/queryKeys';

export function useExecutionHistoryQuery(playbookId: string | null | undefined) {
  return useQuery({
    queryKey: playbookKeys.executions(playbookId ?? ''),
    queryFn: () => getFlowExecutions(playbookId as string),
    enabled: playbookFeatures.queryEnabled && Boolean(playbookId),
  });
}

export function useExecutionDetailQuery(executionId: string | null | undefined) {
  return useQuery({
    queryKey: playbookKeys.execution(executionId ?? ''),
    queryFn: () => getFlowExecutionDetail(executionId as string),
    enabled: playbookFeatures.queryEnabled && Boolean(executionId),
  });
}

export function useActiveExecutionsQuery() {
  return useQuery({
    queryKey: playbookKeys.activeExecutions(),
    queryFn: getActiveExecutions,
    enabled: playbookFeatures.queryEnabled,
  });
}
