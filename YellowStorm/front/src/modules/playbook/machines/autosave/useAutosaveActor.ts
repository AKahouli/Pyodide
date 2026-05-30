import { useEffect, useMemo } from 'react';
import { useSelector } from '@xstate/react';
import { createActor } from 'xstate';

import {
  autosaveMachine,
  type AutosaveMachineEvent,
  type AutosaveStatus,
} from '@/modules/playbook/machines/autosave/autosaveMachine';

export type AutosaveActorSnapshot = {
  status: AutosaveStatus;
  canSaveNow: boolean;
  isSaving: boolean;
  isBlockedByConflict: boolean;
  send: (event: AutosaveMachineEvent) => void;
};

/** Provides one autosave lifecycle actor for the mounted editor while preserving the hook contract. */
export function useAutosaveActor(enabled: boolean): AutosaveActorSnapshot {
  const actor = useMemo(() => createActor(autosaveMachine), []);

  useEffect(() => {
    actor.start();
    return () => {
      actor.stop();
    };
  }, [actor]);

  const snapshot = useSelector(actor, (state) => state);
  const status = (enabled ? snapshot.value : 'clean') as AutosaveStatus;

  return {
    status,
    canSaveNow: enabled && !['savingDelta', 'savingFull', 'conflict'].includes(status),
    isSaving: enabled && ['savingDelta', 'savingFull'].includes(status),
    isBlockedByConflict: enabled && status === 'conflict',
    send: actor.send,
  };
}
