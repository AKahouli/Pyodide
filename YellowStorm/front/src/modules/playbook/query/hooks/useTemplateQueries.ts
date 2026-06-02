import { useQuery } from '@tanstack/react-query';

import { playbookFeatures } from '@/modules/playbook/features';
import {
  getFlowNodeKinds,
  getFlowNodeTemplates,
} from '@/modules/playbook/api';
import { playbookKeys } from '@/modules/playbook/query/queryKeys';

/**
 * Reads reusable flow templates without taking over the Zustand editor state.
 */
export function useNodeTemplatesQuery() {
  return useQuery({
    queryKey: playbookKeys.templates(),
    queryFn: getFlowNodeTemplates,
    enabled: playbookFeatures.queryEnabled,
  });
}

/**
 * Reads server-declared node kinds used by template tooling and creation menus.
 */
export function useFlowNodeKindsQuery() {
  return useQuery({
    queryKey: playbookKeys.flowNodeKinds(),
    queryFn: getFlowNodeKinds,
    enabled: playbookFeatures.queryEnabled,
  });
}
