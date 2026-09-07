import { create } from 'zustand';
import type { ConversationPlaybookPreviewV1, PreparedConversationPlaybookHandoffV1 } from '@/modules/conversation/types';

export interface PendingPlaybookHandoffDraft {
  handoffId: string;
  platformConversationId: string;
  suggestedPrompt: string;
  preview: ConversationPlaybookPreviewV1;
  expiresAt: string;
  messageRequestId: string;
}

interface PlatformCopilotPanelState {
  open: boolean;
  pendingPrompt: string | null;
  pendingHandoff: PendingPlaybookHandoffDraft | null;
  openPanel: (prefill?: string) => void;
  closePanel: () => void;
  consumePendingPrompt: () => string | null;
  openHandoff: (handoff: PreparedConversationPlaybookHandoffV1) => void;
  clearHandoff: () => void;
}

/**
 * Global open state for the Yellowmind assistant panel (PlatformCopilotMascot).
 * The canvas "Designer" button now opens this panel instead of the local playbook designer,
 * so the open state must be reachable from any route.
 */
export const usePlatformCopilotPanelStore = create<PlatformCopilotPanelState>((set, get) => ({
  open: false,
  pendingPrompt: null,
  pendingHandoff: null,
  openPanel: (prefill?: string) => set({ open: true, pendingPrompt: prefill ?? null }),
  closePanel: () => set({ open: false }),
  consumePendingPrompt: () => {
    const prompt = get().pendingPrompt;
    set({ pendingPrompt: null });
    return prompt;
  },
  openHandoff: (handoff) => set({
    open: true,
    pendingPrompt: null,
    pendingHandoff: {
      handoffId: handoff.handoffId,
      platformConversationId: handoff.platformConversationId,
      suggestedPrompt: handoff.suggestedPrompt,
      preview: handoff.preview,
      expiresAt: handoff.expiresAt,
      messageRequestId: crypto.randomUUID(),
    },
  }),
  clearHandoff: () => set({ pendingHandoff: null }),
}));
