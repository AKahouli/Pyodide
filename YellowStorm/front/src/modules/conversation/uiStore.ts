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
  contextPanel: 'outline' | 'work' | 'files' | null;
  setContextPanel: (panel: 'outline' | 'work' | 'files' | null) => void;
  assetPromptRequest: { actorId: string; conversationId: string; ref: string; name: string; nonce: number } | null;
  requestAssetPrompt: (actorId: string, conversationId: string, ref: string, name: string) => void;
  consumeAssetPrompt: () => void;
  assetListRevision: number;
  invalidateAssets: () => void;
  contextPanelWidth: number;
  setContextPanelWidth: (width: number) => void;
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
  outlineCollapsed: true,
  contextPanel: null,
  contextPanelWidth: 320,
  autoReliabilityEnabled: false,
  assetPromptRequest: null,
  assetListRevision: 0,
} as {
  outlineHeadingsByMessageId: Record<string, MarkdownHeadingInfo[]>;
  outlineScrollRequest: OutlineScrollRequest | null;
  activeOutlineAnchorId: string | null;
  outlineCollapsed: boolean;
  contextPanel: 'outline' | 'work' | 'files' | null;
  contextPanelWidth: number;
  autoReliabilityEnabled: boolean;
  assetPromptRequest: ConversationUiState['assetPromptRequest'];
  assetListRevision: number;
};

let outlineScrollNonce = 0;

export const CONTEXT_PANEL_PREFS_KEY = 'conversation.contextPanel';
export function readContextPanelPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(CONTEXT_PANEL_PREFS_KEY) || '{}');
    const contextPanel = saved?.panel === 'outline' || saved?.panel === 'work' || saved?.panel === 'files' ? saved.panel as ConversationUiState['contextPanel'] : null;
    const contextPanelWidth = typeof saved?.width === 'number' && Number.isFinite(saved.width) ? Math.min(480, Math.max(260, saved.width)) : 320;
    return { contextPanel, contextPanelWidth, outlineCollapsed: contextPanel !== 'outline' };
  } catch {
    return { contextPanel: null, contextPanelWidth: 320, outlineCollapsed: true };
  }
}

function persistContextPanel(panel: ConversationUiState['contextPanel'], width: number) {
  try {
    localStorage.setItem(CONTEXT_PANEL_PREFS_KEY, JSON.stringify({ panel, width }));
  } catch {
    // Storage may be unavailable; the in-memory preference still works.
    return;
  }
}

function headingsEqual(a: MarkdownHeadingInfo[], b: MarkdownHeadingInfo[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((heading, index) => heading.id === b[index].id && heading.level === b[index].level && heading.text === b[index].text);
}

export const useConversationUiStore = create<ConversationUiState>()(
  devtools(
    (set, get) => ({
      ...initialConversationUiState,
      ...readContextPanelPreferences(),
      requestAssetPrompt: (actorId, conversationId, ref, name) => {
        outlineScrollNonce += 1;
        set({ assetPromptRequest: { actorId, conversationId, ref, name, nonce: outlineScrollNonce } }, false, 'requestAssetPrompt');
      },
      consumeAssetPrompt: () => set({ assetPromptRequest: null }, false, 'consumeAssetPrompt'),
      invalidateAssets: () => set(state => ({ assetListRevision: state.assetListRevision + 1 }), false, 'invalidateAssets'),
      setContextPanel: (contextPanel) => {
        set({ contextPanel, outlineCollapsed: contextPanel !== 'outline' }, false, 'setContextPanel');
        persistContextPanel(contextPanel, get().contextPanelWidth);
      },
      setContextPanelWidth: (width) => {
        if (!Number.isFinite(width)) return;
        const contextPanelWidth = Math.min(480, Math.max(260, width));
        set({ contextPanelWidth }, false, 'setContextPanelWidth');
        persistContextPanel(get().contextPanel, contextPanelWidth);
      },
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
        get().setContextPanel(collapsed ? null : 'outline');
      },
      setAutoReliabilityEnabled: (enabled) => {
        if (get().autoReliabilityEnabled === enabled) return;
        set({ autoReliabilityEnabled: enabled }, false, 'setAutoReliabilityEnabled');
      },
    }),
    { name: 'conversation-ui-store' },
  ),
);
