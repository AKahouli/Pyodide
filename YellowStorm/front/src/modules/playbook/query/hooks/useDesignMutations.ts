import { useMutation } from '@tanstack/react-query';

import { playbookQueryClient } from '@/modules/playbook/query/queryClient';
import {
  designFlowMutation,
  startDesignOperationMutation,
} from '@/modules/playbook/query/mutationActions';

/** Runs the current synchronous design endpoint while preparing Query-owned design state. */
export function useDesignFlowMutation() {
  return useMutation({
    mutationFn: designFlowMutation,
  }, playbookQueryClient);
}

/** Starts the async design-operation endpoint when the feature flag is enabled. */
export function useStartDesignOperationMutation() {
  return useMutation({
    mutationFn: startDesignOperationMutation,
  }, playbookQueryClient);
}
