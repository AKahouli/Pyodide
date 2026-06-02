import type { AutosaveMachineContext } from '@/modules/playbook/machines/autosave/autosaveMachine';

export function hasBackoffActive(context: AutosaveMachineContext, now = Date.now()) {
  return typeof context.backoffUntil === 'number' && context.backoffUntil > now;
}

export function hasPendingDirtyVersion(context: AutosaveMachineContext) {
  return context.dirtyVersion > context.savingDirtyVersion;
}
