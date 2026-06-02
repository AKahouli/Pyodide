import { useQuery } from '@tanstack/react-query';

import { playbookFeatures } from '@/modules/playbook/features';
import {
  getFlowOutputFormatTemplate,
  getFlowRepeatability,
  getFlowTaskReplays,
} from '@/modules/playbook/api';
import { playbookKeys } from '@/modules/playbook/query/queryKeys';

export function useReplayReportsQuery(flowId: string | null | undefined, taskId: string | null | undefined) {
  return useQuery({
    queryKey: playbookKeys.flowReplays(flowId ?? '', taskId ?? ''),
    queryFn: () => getFlowTaskReplays(flowId as string, taskId as string),
    enabled: playbookFeatures.queryEnabled && Boolean(flowId) && Boolean(taskId),
  });
}

export function useRepeatabilityQuery(flowId: string | null | undefined) {
  return useQuery({
    queryKey: playbookKeys.flowRepeatability(flowId ?? ''),
    queryFn: () => getFlowRepeatability(flowId as string),
    enabled: playbookFeatures.queryEnabled && Boolean(flowId),
  });
}

export function useOutputFormatTemplateQuery(
  flowId: string | null | undefined,
  taskId: string | null | undefined,
) {
  return useQuery({
    queryKey: playbookKeys.flowOutputFormatTemplate(flowId ?? '', taskId ?? ''),
    queryFn: () => getFlowOutputFormatTemplate(flowId as string, taskId as string),
    enabled: playbookFeatures.queryEnabled && Boolean(flowId) && Boolean(taskId),
  });
}
