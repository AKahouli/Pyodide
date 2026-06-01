import { useMutation } from '@tanstack/react-query';

import { playbookQueryClient } from '@/modules/playbook/query/queryClient';
import {
  clonePlaybookMutation,
  createPlaybookMutation,
  deletePlaybookMutation,
  patchFlowDeltaMutation,
  updatePlaybookMutation,
} from '@/modules/playbook/query/mutationActions';

/** Creates a playbook and refreshes list buckets that may contain the new summary. */
export function useCreatePlaybookMutation() {
  return useMutation({
    mutationFn: createPlaybookMutation,
  }, playbookQueryClient);
}

/** Updates the legacy playbook cache while invalidating split flow detail reads. */
export function useUpdatePlaybookMutation() {
  return useMutation({
    mutationFn: updatePlaybookMutation,
  }, playbookQueryClient);
}

/** Persists canvas deltas through the same endpoint used by autosave. */
export function usePatchFlowDeltaMutation() {
  return useMutation({
    mutationFn: patchFlowDeltaMutation,
  }, playbookQueryClient);
}

export function useDeletePlaybookMutation() {
  return useMutation({
    mutationFn: deletePlaybookMutation,
  }, playbookQueryClient);
}

export function useClonePlaybookMutation() {
  return useMutation({
    mutationFn: clonePlaybookMutation,
  }, playbookQueryClient);
}
