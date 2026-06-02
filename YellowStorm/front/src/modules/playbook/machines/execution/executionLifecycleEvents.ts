import { sendExecutionLifecycleEvent } from '@/modules/playbook/machines/execution/executionActorRegistry';
import type { PlaybookExecution } from '@/modules/playbook/types';
import type { PlaybookStreamEvent } from '@/modules/playbook/stream/eventTypes';

/** Converts server stream payloads into lifecycle events while leaving execution data in Query. */
export function dispatchExecutionLifecycleStreamEvent(event: PlaybookStreamEvent) {
  switch (event.type) {
    case 'playbook_connected':
      hydrateActiveExecutions(event.data.activeExecutions);
      return;
    case 'playbook_execution_start':
      sendExecutionLifecycleEvent(event.data.executionId, {
        type: 'START_ACCEPTED',
        executionId: event.data.executionId,
        playbookId: event.data.playbookId,
        status: event.data.status,
      });
      sendExecutionLifecycleEvent(event.data.executionId, event.data.status === 'queued' ? { type: 'QUEUE_UPDATED' } : { type: 'EXECUTION_STARTED' });
      return;
    case 'playbook_step_start':
      sendExecutionLifecycleEvent(event.data.executionId, { type: 'STEP_STARTED' });
      return;
    case 'playbook_step_update':
      sendExecutionLifecycleEvent(event.data.executionId, { type: 'STEP_UPDATED' });
      return;
    case 'playbook_step_complete':
      sendExecutionLifecycleEvent(event.data.executionId, { type: 'STEP_COMPLETED' });
      return;
    case 'playbook_interrupt':
      sendExecutionLifecycleEvent(event.data.executionId, { type: 'INTERRUPT_RECEIVED' });
      return;
    case 'playbook_execution_complete':
    case 'playbook_execution_error':
      sendExecutionLifecycleEvent(event.data.executionId, toTerminalEvent(event.data.status));
      return;
    default:
      return;
  }
}

function hydrateActiveExecutions(activeExecutions: unknown[] | undefined) {
  if (!Array.isArray(activeExecutions)) return;

  for (const execution of activeExecutions) {
    if (!isPlaybookExecution(execution)) continue;
    sendExecutionLifecycleEvent(execution.id, {
      type: 'START_ACCEPTED',
      executionId: execution.id,
      playbookId: execution.playbookId,
      status: execution.status,
    });
    sendExecutionLifecycleEvent(execution.id, execution.status === 'queued' ? { type: 'QUEUE_UPDATED' } : { type: 'EXECUTION_STARTED' });
  }
}

function toTerminalEvent(status: string) {
  if (status === 'cancelled') return { type: 'EXECUTION_CANCELLED' } as const;
  if (status === 'failed') return { type: 'EXECUTION_FAILED' } as const;
  return { type: 'EXECUTION_COMPLETED' } as const;
}

function isPlaybookExecution(value: unknown): value is PlaybookExecution {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PlaybookExecution>;
  return typeof candidate.id === 'string' && typeof candidate.playbookId === 'string' && typeof candidate.status === 'string';
}
