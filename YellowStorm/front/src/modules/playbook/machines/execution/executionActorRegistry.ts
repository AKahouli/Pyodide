import { createActor, type ActorRefFrom } from 'xstate';

import {
  executionMachine,
  type ExecutionLifecycleStatus,
  type ExecutionLifecycleEvent,
  getExecutionLifecycleFlags,
} from '@/modules/playbook/machines/execution/executionMachine';

type ExecutionActor = ActorRefFrom<typeof executionMachine>;

type RegistryEntry = {
  actor: ExecutionActor;
  subscribers: number;
  stopTimer: ReturnType<typeof setTimeout> | null;
};

const entries = new Map<string, RegistryEntry>();
const TERMINAL_STOP_DELAY_MS = 10 * 60_000;

/** Owns one execution lifecycle actor per execution id and keeps actor lifetime bounded. */
export function getExecutionActor(executionId: string) {
  const existing = entries.get(executionId);
  if (existing) {
    clearStopTimer(existing);
    return existing.actor;
  }

  const actor = createActor(executionMachine).start();
  entries.set(executionId, { actor, subscribers: 0, stopTimer: null });
  return actor;
}

export function retainExecutionActor(executionId: string) {
  const entry = getEntry(executionId);
  entry.subscribers += 1;
  clearStopTimer(entry);
  return entry.actor;
}

export function releaseExecutionActor(executionId: string) {
  const entry = entries.get(executionId);
  if (!entry) return;

  entry.subscribers = Math.max(0, entry.subscribers - 1);
  if (entry.subscribers === 0 && getExecutionLifecycleFlags(getActorStatus(entry.actor)).isTerminal) {
    scheduleStop(executionId, entry);
  }
}

export function sendExecutionLifecycleEvent(executionId: string, event: ExecutionLifecycleEvent) {
  const entry = getEntry(executionId);
  entry.actor.send(event);

  if (getExecutionLifecycleFlags(getActorStatus(entry.actor)).isTerminal && entry.subscribers === 0) {
    scheduleStop(executionId, entry);
  }
}

export function resetExecutionActorRegistry() {
  for (const entry of entries.values()) {
    clearStopTimer(entry);
    entry.actor.stop();
  }
  entries.clear();
}

function getEntry(executionId: string) {
  let entry = entries.get(executionId);
  if (!entry) {
    const actor = createActor(executionMachine).start();
    entry = { actor, subscribers: 0, stopTimer: null };
    entries.set(executionId, entry);
  }
  return entry;
}

function scheduleStop(executionId: string, entry: RegistryEntry) {
  clearStopTimer(entry);
  entry.stopTimer = setTimeout(() => {
    const current = entries.get(executionId);
    if (current !== entry || current.subscribers > 0) return;
    current.actor.stop();
    entries.delete(executionId);
  }, TERMINAL_STOP_DELAY_MS);
}

function clearStopTimer(entry: RegistryEntry) {
  if (entry.stopTimer === null) return;
  clearTimeout(entry.stopTimer);
  entry.stopTimer = null;
}

function getActorStatus(actor: ExecutionActor): ExecutionLifecycleStatus {
  return actor.getSnapshot().value as ExecutionLifecycleStatus;
}
