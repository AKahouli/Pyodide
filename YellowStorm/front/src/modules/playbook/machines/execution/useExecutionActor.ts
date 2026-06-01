import { useEffect, useMemo } from 'react';
import { useSelector } from '@xstate/react';

import {
  releaseExecutionActor,
  retainExecutionActor,
} from '@/modules/playbook/machines/execution/executionActorRegistry';
import {
  type ExecutionLifecycleStatus,
  getExecutionLifecycleFlags,
} from '@/modules/playbook/machines/execution/executionMachine';

export type ExecutionLifecycleSnapshot = {
  status: ExecutionLifecycleStatus;
  canStart: boolean;
  canCancel: boolean;
  canResume: boolean;
  isTerminal: boolean;
  isActive: boolean;
  isWaitingForHuman: boolean;
};

/** Subscribes UI code to a stable execution lifecycle actor without exposing payload state. */
export function useExecutionActor(executionId: string | null | undefined): ExecutionLifecycleSnapshot {
  const actor = useMemo(() => executionId ? retainExecutionActor(executionId) : null, [executionId]);

  useEffect(() => {
    if (!executionId) return;
    return () => releaseExecutionActor(executionId);
  }, [executionId]);

  return useSelector(actor ?? undefined, (snapshot) => {
    const status = (snapshot?.value ?? 'idle') as ExecutionLifecycleStatus;
    return { status, ...getExecutionLifecycleFlags(status) };
  });
}
