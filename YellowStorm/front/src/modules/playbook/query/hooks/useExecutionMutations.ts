import { useMutation } from '@tanstack/react-query';

import { playbookFeatures } from '@/modules/playbook/features';
import { sendExecutionLifecycleEvent } from '@/modules/playbook/machines/execution/executionActorRegistry';
import { playbookQueryClient } from '@/modules/playbook/query/queryClient';
import {
  cancelExecutionMutation,
  resumeApprovalMutation,
  resumeFromStepMutation,
  startExecutionMutation,
} from '@/modules/playbook/query/mutationActions';

/** Starts executions via Query so active/history caches can be invalidated consistently. */
export function useStartExecutionMutation() {
  return useMutation({
    mutationFn: startExecutionMutation,
    onSuccess: (result, variables) => {
      if (!playbookFeatures.xstateExecutionEnabled || typeof result.executionId !== 'string') return;
      sendExecutionLifecycleEvent(result.executionId, {
        type: 'START_ACCEPTED',
        executionId: result.executionId,
        playbookId: variables.flowId,
      });
    },
  }, playbookQueryClient);
}

export function useCancelExecutionMutation() {
  return useMutation({
    mutationFn: cancelExecutionMutation,
    onMutate: (executionId) => {
      if (playbookFeatures.xstateExecutionEnabled) {
        sendExecutionLifecycleEvent(executionId, { type: 'CANCEL_REQUESTED' });
      }
    },
    onSuccess: (_result, executionId) => {
      if (playbookFeatures.xstateExecutionEnabled) {
        sendExecutionLifecycleEvent(executionId, { type: 'CANCEL_ACCEPTED' });
      }
    },
  }, playbookQueryClient);
}

export function useResumeApprovalMutation() {
  return useMutation({
    mutationFn: resumeApprovalMutation,
    onMutate: ({ executionId }) => {
      if (playbookFeatures.xstateExecutionEnabled) {
        sendExecutionLifecycleEvent(executionId, { type: 'RESUME_REQUESTED' });
      }
    },
    onSuccess: (_result, { executionId }) => {
      if (playbookFeatures.xstateExecutionEnabled) {
        sendExecutionLifecycleEvent(executionId, { type: 'RESUME_ACCEPTED' });
      }
    },
  }, playbookQueryClient);
}

export function useResumeFromStepMutation() {
  return useMutation({
    mutationFn: resumeFromStepMutation,
    onMutate: ({ executionId }) => {
      if (playbookFeatures.xstateExecutionEnabled) {
        sendExecutionLifecycleEvent(executionId, { type: 'RESUME_REQUESTED' });
      }
    },
    onSuccess: (result, variables) => {
      if (!playbookFeatures.xstateExecutionEnabled) return;
      sendExecutionLifecycleEvent(variables.executionId, { type: 'RESUME_ACCEPTED' });
      if (typeof result.executionId === 'string') {
        sendExecutionLifecycleEvent(result.executionId, {
          type: 'START_ACCEPTED',
          executionId: result.executionId,
          playbookId: variables.playbookId,
        });
      }
    },
  }, playbookQueryClient);
}
