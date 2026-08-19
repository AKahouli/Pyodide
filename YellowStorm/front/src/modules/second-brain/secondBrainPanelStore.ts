import { create } from 'zustand';

interface SecondBrainPanelState {
  open: boolean;
  pendingPrompt: string | null;
  openPanel: (prefill?: string) => void;
  closePanel: () => void;
  consumePendingPrompt: () => string | null;
}

/**
 * Global open state for the Yellowmind assistant panel (SecondBrainMascot).
 * The canvas "Designer" button now opens this panel instead of the local playbook designer,
 * so the open state must be reachable from any route.
 */
export const useSecondBrainPanelStore = create<SecondBrainPanelState>((set, get) => ({
  open: false,
  pendingPrompt: null,
  openPanel: (prefill?: string) => set({ open: true, pendingPrompt: prefill ?? null }),
  closePanel: () => set({ open: false }),
  consumePendingPrompt: () => {
    const prompt = get().pendingPrompt;
    set({ pendingPrompt: null });
    return prompt;
  },
}));
