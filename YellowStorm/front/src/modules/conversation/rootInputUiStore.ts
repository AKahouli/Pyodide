import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { PendingRootInput } from './types';

export const initialRootInputUiState = {
  scope: '', roots: [] as PendingRootInput[], submitted: [] as string[], drafts: {} as Record<string, unknown>, submitting: [] as string[],
};

interface RootInputUiState {
  scope: string;
  roots: PendingRootInput[];
  submitted: string[];
  drafts: Record<string, unknown>;
  submitting: string[];
  setSubmitting: (scope: string, key: string, submitting: boolean) => void;
  reset: (scope: string) => void;
  setRoots: (scope: string, roots: PendingRootInput[]) => void;
  setDraft: (scope: string, key: string, value: unknown) => void;
  markSubmitted: (scope: string, key: string) => void;
}

export const useRootInputUiStore = create<RootInputUiState>()(devtools((set, get) => ({
  ...initialRootInputUiState,
  reset: (scope) => set({ ...initialRootInputUiState, scope }, false, 'reset'),
  setSubmitting: (scope, key, submitting) => {
    if (get().scope === scope) set((state) => ({ submitting: submitting ? [...new Set([...state.submitting, key])] : state.submitting.filter((value) => value !== key) }), false, 'setSubmitting');
  },
  setRoots: (scope, roots) => { if (get().scope === scope) set({ roots }, false, 'setRoots'); },
  setDraft: (scope, key, value) => {
    if (get().scope === scope) set((state) => ({ drafts: { ...state.drafts, [key]: value } }), false, 'setDraft');
  },
  markSubmitted: (scope, key) => {
    if (get().scope !== scope) return;
    set((state) => {
      const drafts = { ...state.drafts };
      delete drafts[key];
      return { drafts, submitted: [...state.submitted, key] };
    }, false, 'markSubmitted');
  },
}), { name: 'conversation-root-input-ui' }));
