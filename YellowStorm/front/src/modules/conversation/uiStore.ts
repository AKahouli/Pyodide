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

export const MAX_SELECTED_CONVERSATION_ASSETS = 8;
export interface SelectedConversationAsset { ref: string; name: string; nonce: number; sourceMessageId?: string }
export interface ConversationUiState {
  selectedAssets: { actorId: string; conversationId: string; items: SelectedConversationAsset[] } | null;
  scopeAssetSelection: (actorId: string, conversationId: string) => void;
  addAssetSelection: (actorId: string, conversationId: string, ref: string, name: string, sourceMessageId?: string) => boolean;
  removeAssetSelection: (actorId: string, conversationId: string, nonce: number) => void;
  clearSubmittedAssets: (actorId: string, conversationId: string, nonces: number[]) => void;
  contextPanel: 'outline' | 'work' | 'files' | null;
  setContextPanel: (panel: 'outline' | 'work' | 'files' | null) => void;
  assetPromptRequest: { actorId: string; conversationId: string; ref: string; name: string; nonce: number; intent?: 'refine'; sourceMessageId?: string } | null;
  requestAssetPrompt: (actorId: string, conversationId: string, ref: string, name: string, intent?: 'refine', sourceMessageId?: string) => void;
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
  selectedAssets: null,
} as {
  outlineHeadingsByMessageId: Record<string, MarkdownHeadingInfo[]>;
  outlineScrollRequest: OutlineScrollRequest | null;
  activeOutlineAnchorId: string | null;
  outlineCollapsed: boolean;
  contextPanel: 'outline' | 'work' | 'files' | null;
  contextPanelWidth: number;
  autoReliabilityEnabled: boolean;
  assetPromptRequest: ConversationUiState['assetPromptRequest'];
  selectedAssets: ConversationUiState['selectedAssets'];
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
      scopeAssetSelection: (actorId, conversationId) => {
        const current = get().selectedAssets;
        if (current?.actorId !== actorId || current.conversationId !== conversationId) set({ selectedAssets: { actorId, conversationId, items: [] } }, false, 'scopeAssetSelection');
      },
      addAssetSelection: (actorId, conversationId, ref, name, sourceMessageId) => {
        if (!actorId || !conversationId || !/^[A-Za-z0-9_-]{1,2048}$/.test(ref)) return false;
        const current = get().selectedAssets;
        const items = current?.actorId === actorId && current.conversationId === conversationId ? current.items : [];
        if (items.some(item => item.ref === ref) && !sourceMessageId) return true;
        if (!items.some(item => item.ref === ref) && items.length >= MAX_SELECTED_CONVERSATION_ASSETS) return false;
        outlineScrollNonce += 1;
        set({ selectedAssets: { actorId, conversationId, items: [...items.filter(item => item.ref !== ref).map(item => sourceMessageId ? { ...item, sourceMessageId: undefined } : item), { ref, name: name.replace(/[\r\n]/g, ' ').slice(0, 240), nonce: outlineScrollNonce, ...(sourceMessageId ? { sourceMessageId } : {}) }] } }, false, 'addAssetSelection');
        return true;
      },
      removeAssetSelection: (actorId, conversationId, nonce) => get().clearSubmittedAssets(actorId, conversationId, [nonce]),
      clearSubmittedAssets: (actorId, conversationId, nonces) => {
        const current = get().selectedAssets;
        if (current?.actorId === actorId && current.conversationId === conversationId) set({ selectedAssets: { ...current, items: current.items.filter(item => !nonces.includes(item.nonce)) } }, false, 'clearSubmittedAssets');
      },
      requestAssetPrompt: (actorId, conversationId, ref, name, intent, sourceMessageId) => {
        outlineScrollNonce += 1;
        set({ assetPromptRequest: { actorId, conversationId, ref, name, nonce: outlineScrollNonce, ...(intent ? { intent } : {}), ...(intent === 'refine' && sourceMessageId ? { sourceMessageId } : {}) } }, false, 'requestAssetPrompt');
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
