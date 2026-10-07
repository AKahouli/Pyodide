import { showSuccess } from '@/lib/notifications';
import { useSemanticModelEditorStore } from '../store';

/**
 * Say that something was removed, with an Undo button for that step. The button only undoes it while it
 * is still the latest step, so a later change is never undone by mistake.
 */
export function announceUndoable(message: string, undoLabel: string, duration?: number) {
  const step = useSemanticModelEditorStore.getState().undoStack.at(-1);
  showSuccess(message, {
    duration,
    action: {
      label: undoLabel,
      onClick: () => {
        const state = useSemanticModelEditorStore.getState();
        if (step && state.undoStack.at(-1) === step) void state.undo();
      },
    },
  });
}

/** A field where Delete and Ctrl+Z belong to the text being typed. */
export function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
    || (target.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes((target as HTMLInputElement).type));
}
