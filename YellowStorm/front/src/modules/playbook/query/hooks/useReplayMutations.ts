import { useMutation } from '@tanstack/react-query';

import { playbookQueryClient } from '@/modules/playbook/query/queryClient';
import {
  updateOutputFormatTemplateMutation,
  validateReplayMutation,
} from '@/modules/playbook/query/mutationActions';

export function useValidateReplayMutation() {
  return useMutation({
    mutationFn: validateReplayMutation,
  }, playbookQueryClient);
}

export function useUpdateOutputFormatTemplateMutation() {
  return useMutation({
    mutationFn: updateOutputFormatTemplateMutation,
  }, playbookQueryClient);
}
