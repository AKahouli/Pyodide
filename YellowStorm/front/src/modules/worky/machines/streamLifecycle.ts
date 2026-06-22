import { createMachine } from 'xstate';
import type { WorkyStreamStatus, WorkyControlState } from '../types';

/**
 * XState v5 machine for the stream lifecycle. The backend owns
 * the canonical state; this machine mirrors it on the client so
 * the UI cannot enter illegal transitions. The store hydrates the
 * machine on stream-load and feeds events from the SSE channel.
 *
 *  ┌─────────────┐  START   ┌───────────────┐
 *  │   created   ├─────────►│    active      │◄──┐
 *  └─────────────┘          └──┬──────────────┘   │
 *                              │ PAUSE           │ RESUME
 *                              ▼                 │
 *                         ┌──────────────┐       │
 *                         │   paused     │───────┘
 *                         └──────┬───────┘
 *                                │ STOP
 *                                ▼
 *                         ┌──────────────┐
 *                         │   stopped    │
 *                         └──────────────┘
 */
export interface StreamLifecycleContext {
  streamId: string | null;
  status: WorkyStreamStatus;
  controlState: WorkyControlState;
}

export type StreamLifecycleEvent =
  | { type: 'START'; streamId: string }
  | { type: 'PAUSE' }
  | { type: 'RESUME' }
  | { type: 'STOP' }
  | { type: 'SYNC'; status: WorkyStreamStatus; controlState: WorkyControlState };

export const streamLifecycleMachine = createMachine({
  id: 'worky-stream-lifecycle',
  initial: 'created',
  context: ({ input }: { input: StreamLifecycleContext }) => ({
    streamId: input.streamId,
    status: input.status,
    controlState: input.controlState,
  }),
  states: {
    created: {
      on: {
        START: { target: 'active' },
        SYNC: [
          { target: 'active', guard: ({ event }) => event.controlState === 'active' },
          { target: 'paused', guard: ({ event }) => event.controlState === 'paused' },
          { target: 'stopped', guard: ({ event }) => event.status === 'stopped' },
        ],
      },
    },
    active: {
      on: {
        PAUSE: 'paused',
        STOP: 'stopped',
        SYNC: [
          { target: 'paused', guard: ({ event }) => event.controlState === 'paused' },
          { target: 'stopped', guard: ({ event }) => event.status === 'stopped' },
        ],
      },
    },
    paused: {
      on: {
        RESUME: 'active',
        STOP: 'stopped',
        SYNC: [
          { target: 'active', guard: ({ event }) => event.controlState === 'active' },
          { target: 'stopped', guard: ({ event }) => event.status === 'stopped' },
        ],
      },
    },
    stopped: {
      type: 'final',
    },
  },
});
