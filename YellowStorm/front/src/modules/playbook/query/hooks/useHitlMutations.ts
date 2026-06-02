import { useMutation } from '@tanstack/react-query';
import { playbookQueryClient } from '@/modules/playbook/query/queryClient';
import {
  createHitlBlockerMutation,
  deleteHitlBlockerMutation,
  updateHitlBlockerMutation,
  updateHitlPolicyMutation,
} from '@/modules/playbook/query/mutationActions';

export function useUpdateHitlPolicyMutation() {
  return useMutation({ mutationFn: updateHitlPolicyMutation }, playbookQueryClient);
}

export function useCreateHitlBlockerMutation() {
  return useMutation({ mutationFn: createHitlBlockerMutation }, playbookQueryClient);
}

export function useUpdateHitlBlockerMutation() {
  return useMutation({ mutationFn: updateHitlBlockerMutation }, playbookQueryClient);
}

export function useDeleteHitlBlockerMutation() {
  return useMutation({ mutationFn: deleteHitlBlockerMutation }, playbookQueryClient);
}
