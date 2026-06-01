import { createMachine } from 'xstate';

export type ExecutionLifecycleStatus =
  | 'idle'
  | 'starting'
  | 'queued'
  | 'running'
  | 'interrupted'
  | 'resuming'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ExecutionLifecycleContext = {
  executionId: string | null;
  playbookId: string | null;
};

export type ExecutionLifecycleEvent =
  | { type: 'START_REQUESTED'; playbookId?: string }
  | { type: 'START_ACCEPTED'; executionId: string; playbookId?: string; status?: string }
  | { type: 'QUEUE_UPDATED' }
  | { type: 'EXECUTION_STARTED' }
  | { type: 'STEP_STARTED' }
  | { type: 'STEP_UPDATED' }
  | { type: 'STEP_COMPLETED' }
  | { type: 'INTERRUPT_RECEIVED' }
  | { type: 'RESUME_REQUESTED' }
  | { type: 'RESUME_ACCEPTED' }
  | { type: 'CANCEL_REQUESTED' }
  | { type: 'CANCEL_ACCEPTED' }
  | { type: 'EXECUTION_COMPLETED' }
  | { type: 'EXECUTION_FAILED' }
  | { type: 'EXECUTION_CANCELLED' };

/** Models execution control state only; Query remains the owner of execution payload data. */
export const executionMachine = createMachine({
  id: 'playbookExecution',
  types: {} as {
    context: ExecutionLifecycleContext;
    events: ExecutionLifecycleEvent;
  },
  context: {
    executionId: null,
    playbookId: null,
  },
  initial: 'idle',
  states: {
    idle: {
      on: {
        START_REQUESTED: { target: 'starting' },
        START_ACCEPTED: [
          { guard: ({ event }) => event.status === 'queued', target: 'queued' },
          { target: 'running' },
        ],
        EXECUTION_STARTED: { target: 'running' },
        QUEUE_UPDATED: { target: 'queued' },
      },
    },
    starting: {
      on: {
        START_ACCEPTED: [
          { guard: ({ event }) => event.status === 'queued', target: 'queued' },
          { target: 'running' },
        ],
        QUEUE_UPDATED: { target: 'queued' },
        CANCEL_REQUESTED: { target: 'cancelling' },
        EXECUTION_FAILED: { target: 'failed' },
      },
    },
    queued: {
      on: {
        EXECUTION_STARTED: { target: 'running' },
        STEP_STARTED: { target: 'running' },
        CANCEL_REQUESTED: { target: 'cancelling' },
        CANCEL_ACCEPTED: { target: 'cancelled' },
        EXECUTION_CANCELLED: { target: 'cancelled' },
        EXECUTION_FAILED: { target: 'failed' },
      },
    },
    running: {
      on: {
        STEP_STARTED: {},
        STEP_UPDATED: {},
        STEP_COMPLETED: {},
        INTERRUPT_RECEIVED: { target: 'interrupted' },
        CANCEL_REQUESTED: { target: 'cancelling' },
        EXECUTION_COMPLETED: { target: 'completed' },
        EXECUTION_FAILED: { target: 'failed' },
        EXECUTION_CANCELLED: { target: 'cancelled' },
      },
    },
    interrupted: {
      on: {
        RESUME_REQUESTED: { target: 'resuming' },
        CANCEL_REQUESTED: { target: 'cancelling' },
        EXECUTION_COMPLETED: { target: 'completed' },
        EXECUTION_FAILED: { target: 'failed' },
        EXECUTION_CANCELLED: { target: 'cancelled' },
      },
    },
    resuming: {
      on: {
        RESUME_ACCEPTED: { target: 'running' },
        STEP_STARTED: { target: 'running' },
        INTERRUPT_RECEIVED: { target: 'interrupted' },
        EXECUTION_COMPLETED: { target: 'completed' },
        EXECUTION_FAILED: { target: 'failed' },
      },
    },
    cancelling: {
      on: {
        CANCEL_ACCEPTED: { target: 'cancelled' },
        EXECUTION_CANCELLED: { target: 'cancelled' },
        EXECUTION_COMPLETED: { target: 'completed' },
        EXECUTION_FAILED: { target: 'failed' },
      },
    },
    completed: {},
    failed: {},
    cancelled: {},
  },
});

export function getExecutionLifecycleFlags(status: ExecutionLifecycleStatus) {
  return {
    canStart: status === 'idle',
    canCancel: ['starting', 'queued', 'running', 'interrupted', 'resuming'].includes(status),
    canResume: status === 'interrupted',
    isTerminal: ['completed', 'failed', 'cancelled'].includes(status),
    isActive: ['starting', 'queued', 'running', 'interrupted', 'resuming', 'cancelling'].includes(status),
    isWaitingForHuman: status === 'interrupted',
  };
}
