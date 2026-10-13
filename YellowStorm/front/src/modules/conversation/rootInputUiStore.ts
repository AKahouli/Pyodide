import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { PendingRootInput } from './types';

export const initialRootInputUiState = {
  scope: '', roots: [] as PendingRootInput[], submitted: [] as string[], drafts: {} as Record<string, unknown>, submitting: [] as string[],
  continuationMessages: {} as Record<string, string>, failures: [] as string[],
};

interface RootInputUiState {
  scope: string;
  roots: PendingRootInput[];
  submitted: string[];
  drafts: Record<string, unknown>;
  submitting: string[];
  continuationMessages: Record<string, string>;
  failures: string[];
  bindContinuation: (scope: string, key: string, messageId?: string) => void;
  failContinuation: (conversationId: string, messageId: string) => void;
  setSubmitting: (scope: string, key: string, submitting: boolean) => void;
  reset: (scope: string) => void;
  setRoots: (scope: string, roots: PendingRootInput[]) => void;
  setDraft: (scope: string, key: string, value: unknown) => void;
  markSubmitted: (scope: string, key: string) => void;
}

export const useRootInputUiStore = create<RootInputUiState>()(devtools((set, get) => ({
  ...initialRootInputUiState,
  reset: (scope) => set({ ...initialRootInputUiState, scope }, false, 'reset'),
  bindContinuation: (scope, key, messageId) => {
    if (get().scope === scope && messageId) set((state) => ({ continuationMessages: {
      ...state.continuationMessages, [key]: messageId,
    } }), false, 'bindContinuation');
  },
  failContinuation: (conversationId, messageId) => {
    if (!get().scope.endsWith(`:${conversationId}`)) return;
    const keys = Object.keys(get().continuationMessages).filter((key) => get().continuationMessages[key] === messageId);
    if (keys.length) set((state) => ({ submitted: state.submitted.filter((key) => !keys.includes(key)),
      failures: [...new Set([...state.failures, ...keys])],
    }), false, 'failContinuation');
  },
  setSubmitting: (scope, key, submitting) => {
    if (get().scope === scope) set((state) => ({
      submitting: submitting ? [...new Set([...state.submitting, key])] : state.submitting.filter((value) => value !== key),
      ...(submitting ? { failures: state.failures.filter((value) => value !== key) } : {}),
    }), false, 'setSubmitting');
  },
  setRoots: (scope, roots) => { if (get().scope === scope) set({ roots }, false, 'setRoots'); },
  setDraft: (scope, key, value) => {
    if (get().scope === scope) set((state) => ({ drafts: { ...state.drafts, [key]: value } }), false, 'setDraft');
  },
  markSubmitted: (scope, key) => {
    if (get().scope !== scope || get().failures.includes(key)) return;
    // HTTP admission precedes native validation. Keep the draft until the
    // request advances, so a correlated stream failure can restore it.
    set((state) => ({ submitted: [...new Set([...state.submitted, key])] }), false, 'markSubmitted');
  },
}), { name: 'conversation-root-input-ui' }));
