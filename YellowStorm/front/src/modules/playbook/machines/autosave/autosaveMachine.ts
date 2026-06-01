import { assign, setup } from 'xstate';

import { hasBackoffActive, hasPendingDirtyVersion } from '@/modules/playbook/machines/autosave/autosaveGuards';

export type AutosaveStatus =
  | 'clean'
  | 'dirty'
  | 'debouncing'
  | 'savingDelta'
  | 'savingFull'
  | 'backingOff'
  | 'conflict'
  | 'failed';

export type AutosaveMachineContext = {
  playbookId: string | null;
  dirtyVersion: number;
  savingDirtyVersion: number;
  lastSavedPayloadHash: string | null;
  lastSavedRequestBody: unknown;
  lastAutosaveDurationMs: number | null;
  backoffUntil: number | null;
  pendingSaveReason: 'autosave' | 'manual' | null;
  lastErrorCode: string | null;
};

export type AutosaveMachineEvent =
  | { type: 'LOCAL_CHANGE'; playbookId?: string | null; dirtyVersion: number }
  | { type: 'SAVE_NOW'; reason: 'autosave' | 'manual' }
  | { type: 'DEBOUNCE_ELAPSED' }
  | { type: 'DELTA_SAVE_SUCCEEDED'; payloadHash?: string | null; requestBody?: unknown; durationMs?: number | null }
  | { type: 'DELTA_SAVE_FAILED'; errorCode?: string | null; backoffUntil?: number | null; fallbackToFull?: boolean }
  | { type: 'FULL_SAVE_SUCCEEDED'; payloadHash?: string | null; requestBody?: unknown; durationMs?: number | null }
  | { type: 'FULL_SAVE_FAILED'; errorCode?: string | null; backoffUntil?: number | null }
  | { type: 'CONFLICT_DETECTED'; errorCode?: string | null }
  | { type: 'RETRY_TIMER_ELAPSED' }
  | { type: 'RESET_FROM_SERVER'; payloadHash?: string | null; requestBody?: unknown };

const autosaveMachineSetup = setup({
  types: {} as {
    context: AutosaveMachineContext;
    events: AutosaveMachineEvent;
  },
  guards: {
    hasBackoffActive: ({ context }) => hasBackoffActive(context),
    hasPendingDirtyVersion: ({ context }) => hasPendingDirtyVersion(context),
    shouldFallbackToFull: ({ event }) => event.type === 'DELTA_SAVE_FAILED' && event.fallbackToFull === true,
    hasFailureBackoff: ({ event }) => 'backoffUntil' in event && Boolean(event.backoffUntil),
  },
  actions: {
    rememberLocalChange: assign({
      playbookId: ({ context, event }) => event.type === 'LOCAL_CHANGE' ? event.playbookId ?? context.playbookId : context.playbookId,
      dirtyVersion: ({ context, event }) => event.type === 'LOCAL_CHANGE' ? event.dirtyVersion : context.dirtyVersion,
    }),
    rememberSaveRequest: assign({
      savingDirtyVersion: ({ context }) => context.dirtyVersion,
      pendingSaveReason: ({ event }) => event.type === 'SAVE_NOW' ? event.reason : 'autosave',
    }),
    rememberSaveSuccess: assign({
      lastSavedPayloadHash: ({ context, event }) => 'payloadHash' in event ? event.payloadHash ?? context.lastSavedPayloadHash : context.lastSavedPayloadHash,
      lastSavedRequestBody: ({ context, event }) => 'requestBody' in event ? event.requestBody ?? context.lastSavedRequestBody : context.lastSavedRequestBody,
      lastAutosaveDurationMs: ({ context, event }) => 'durationMs' in event ? event.durationMs ?? context.lastAutosaveDurationMs : context.lastAutosaveDurationMs,
      pendingSaveReason: () => null,
      lastErrorCode: () => null,
      backoffUntil: () => null,
    }),
    rememberFailure: assign({
      lastErrorCode: ({ event }) => 'errorCode' in event ? event.errorCode ?? null : null,
      backoffUntil: ({ event }) => 'backoffUntil' in event ? event.backoffUntil ?? null : null,
    }),
    resetFromServer: assign({
      dirtyVersion: () => 0,
      savingDirtyVersion: () => 0,
      lastSavedPayloadHash: ({ event }) => event.type === 'RESET_FROM_SERVER' ? event.payloadHash ?? null : null,
      lastSavedRequestBody: ({ event }) => event.type === 'RESET_FROM_SERVER' ? event.requestBody : null,
      pendingSaveReason: () => null,
      lastErrorCode: () => null,
      backoffUntil: () => null,
    }),
    clearBackoff: assign({
      backoffUntil: () => null,
    }),
  },
});

/** Tracks autosave lifecycle decisions; the existing hook still owns timers while this is flagged on. */
export const autosaveMachine = autosaveMachineSetup.createMachine({
  id: 'playbookAutosave',
  types: {} as {
    context: AutosaveMachineContext;
    events: AutosaveMachineEvent;
  },
  context: {
    playbookId: null,
    dirtyVersion: 0,
    savingDirtyVersion: 0,
    lastSavedPayloadHash: null,
    lastSavedRequestBody: null,
    lastAutosaveDurationMs: null,
    backoffUntil: null,
    pendingSaveReason: null,
    lastErrorCode: null,
  },
  initial: 'clean',
  states: {
    clean: {
      on: {
        LOCAL_CHANGE: { target: 'dirty', actions: 'rememberLocalChange' },
        SAVE_NOW: { target: 'savingDelta', actions: 'rememberSaveRequest' },
        RESET_FROM_SERVER: { actions: 'resetFromServer' },
      },
    },
    dirty: {
      always: { guard: 'hasBackoffActive', target: 'backingOff' },
      on: {
        SAVE_NOW: { target: 'savingDelta', actions: 'rememberSaveRequest' },
        LOCAL_CHANGE: { target: 'debouncing', actions: 'rememberLocalChange' },
        DEBOUNCE_ELAPSED: { target: 'savingDelta', actions: 'rememberSaveRequest' },
      },
    },
    debouncing: {
      on: {
        LOCAL_CHANGE: { actions: 'rememberLocalChange' },
        SAVE_NOW: { target: 'savingDelta', actions: 'rememberSaveRequest' },
        DEBOUNCE_ELAPSED: { target: 'savingDelta', actions: 'rememberSaveRequest' },
      },
    },
    savingDelta: {
      on: {
        LOCAL_CHANGE: { actions: 'rememberLocalChange' },
        DELTA_SAVE_SUCCEEDED: [
          { guard: 'hasPendingDirtyVersion', target: 'dirty', actions: 'rememberSaveSuccess' },
          { target: 'clean', actions: 'rememberSaveSuccess' },
        ],
        DELTA_SAVE_FAILED: [
          { guard: 'shouldFallbackToFull', target: 'savingFull', actions: 'rememberFailure' },
          { guard: 'hasFailureBackoff', target: 'backingOff', actions: 'rememberFailure' },
          { target: 'failed', actions: 'rememberFailure' },
        ],
        CONFLICT_DETECTED: { target: 'conflict', actions: 'rememberFailure' },
      },
    },
    savingFull: {
      on: {
        LOCAL_CHANGE: { actions: 'rememberLocalChange' },
        FULL_SAVE_SUCCEEDED: [
          { guard: 'hasPendingDirtyVersion', target: 'dirty', actions: 'rememberSaveSuccess' },
          { target: 'clean', actions: 'rememberSaveSuccess' },
        ],
        FULL_SAVE_FAILED: [
          { guard: 'hasFailureBackoff', target: 'backingOff', actions: 'rememberFailure' },
          { target: 'failed', actions: 'rememberFailure' },
        ],
        CONFLICT_DETECTED: { target: 'conflict', actions: 'rememberFailure' },
      },
    },
    backingOff: {
      on: {
        LOCAL_CHANGE: { actions: 'rememberLocalChange' },
        RETRY_TIMER_ELAPSED: { target: 'dirty', actions: 'clearBackoff' },
        SAVE_NOW: { target: 'savingDelta', actions: 'rememberSaveRequest' },
      },
    },
    conflict: {
      on: {
        RESET_FROM_SERVER: { target: 'clean', actions: 'resetFromServer' },
        LOCAL_CHANGE: { target: 'dirty', actions: 'rememberLocalChange' },
      },
    },
    failed: {
      on: {
        SAVE_NOW: { target: 'savingDelta', actions: 'rememberSaveRequest' },
        LOCAL_CHANGE: { target: 'dirty', actions: 'rememberLocalChange' },
        RESET_FROM_SERVER: { target: 'clean', actions: 'resetFromServer' },
      },
    },
  },
});
