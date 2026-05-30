import { useMutation } from '@tanstack/react-query';

import { playbookQueryClient } from '@/modules/playbook/query/queryClient';
import {
  upsertTriggerMailMutation,
  upsertTriggerScheduleMutation,
} from '@/modules/playbook/query/mutationActions';

export function useUpsertTriggerScheduleMutation() {
  return useMutation({
    mutationFn: upsertTriggerScheduleMutation,
  }, playbookQueryClient);
}

export function useUpsertTriggerMailMutation() {
  return useMutation({
    mutationFn: upsertTriggerMailMutation,
  }, playbookQueryClient);
}
