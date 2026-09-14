import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { MarkdownHeadingInfo } from '@/components/ai-elements/ai-message-content';

/**
 * UI-only state for the conversation module (document outline rail).
 * Server data stays in `store.ts`; this store only tracks render-derived
 * outline anchors, scroll requests, and rail visibility.
 */
export interface OutlineScrollRequest {
  anchorId: string;
  /** Increments on every request so re-clicking the same entry scrolls again. */
  nonce: number;
}

export interface ConversationUiState {
  /** Anchor ids live in the DOM (rendered headings / message wrappers), keyed by AI message id. */
  outlineHeadingsByMessageId: Record<string, MarkdownHeadingInfo[]>;
  setOutlineHeadings: (messageId: string, headings: MarkdownHeadingInfo[]) => void;
  clearOutlineHeadings: (messageId: string) => void;
  outlineScrollRequest: OutlineScrollRequest | null;
  requestOutlineScroll: (anchorId: string) => void;
  consumeOutlineScroll: () => void;
  activeOutlineAnchorId: string | null;
  setActiveOutlineAnchor: (anchorId: string | null) => void;
  outlineCollapsed: boolean;
  setOutlineCollapsed: (collapsed: boolean) => void;
  /** Prompt-bar opt-in: show the reliability pane and auto-run evaluation when a response completes. */
  autoReliabilityEnabled: boolean;
  setAutoReliabilityEnabled: (enabled: boolean) => void;
}

export const initialConversationUiState = {
  outlineHeadingsByMessageId: {},
  outlineScrollRequest: null,
  activeOutlineAnchorId: null,
  outlineCollapsed: false,
  autoReliabilityEnabled: false,
} as {
  outlineHeadingsByMessageId: Record<string, MarkdownHeadingInfo[]>;
  outlineScrollRequest: OutlineScrollRequest | null;
  activeOutlineAnchorId: string | null;
  outlineCollapsed: boolean;
  autoReliabilityEnabled: boolean;
};

let outlineScrollNonce = 0;

function headingsEqual(a: MarkdownHeadingInfo[], b: MarkdownHeadingInfo[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((heading, index) => heading.id === b[index].id && heading.level === b[index].level && heading.text === b[index].text);
}

export const useConversationUiStore = create<ConversationUiState>()(
  devtools(
    (set, get) => ({
      ...initialConversationUiState,
      setOutlineHeadings: (messageId, headings) => {
        const existing = get().outlineHeadingsByMessageId[messageId];
        if (existing && headingsEqual(existing, headings)) return;
        set((state) => ({ outlineHeadingsByMessageId: { ...state.outlineHeadingsByMessageId, [messageId]: headings } }), false, 'setOutlineHeadings');
      },
      clearOutlineHeadings: (messageId) => {
        if (!get().outlineHeadingsByMessageId[messageId]) return;
        set((state) => {
          const next = { ...state.outlineHeadingsByMessageId };
          delete next[messageId];
          return { outlineHeadingsByMessageId: next };
        }, false, 'clearOutlineHeadings');
      },
      requestOutlineScroll: (anchorId) => {
        outlineScrollNonce += 1;
        set({ outlineScrollRequest: { anchorId, nonce: outlineScrollNonce } }, false, 'requestOutlineScroll');
      },
      consumeOutlineScroll: () => {
        if (!get().outlineScrollRequest) return;
        set({ outlineScrollRequest: null }, false, 'consumeOutlineScroll');
      },
      setActiveOutlineAnchor: (anchorId) => {
        if (get().activeOutlineAnchorId === anchorId) return;
        set({ activeOutlineAnchorId: anchorId }, false, 'setActiveOutlineAnchor');
      },
      setOutlineCollapsed: (collapsed) => {
        if (get().outlineCollapsed === collapsed) return;
        set({ outlineCollapsed: collapsed }, false, 'setOutlineCollapsed');
      },
      setAutoReliabilityEnabled: (enabled) => {
        if (get().autoReliabilityEnabled === enabled) return;
        set({ autoReliabilityEnabled: enabled }, false, 'setAutoReliabilityEnabled');
      },
    }),
    { name: 'conversation-ui-store' },
  ),
);
