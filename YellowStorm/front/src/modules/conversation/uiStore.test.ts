import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('conversation UI reliability state', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('always initializes disabled and does not persist opt-in', async () => {
    localStorage.setItem('autoReliabilityEnabled', 'true');
    const { initialConversationUiState, useConversationUiStore } = await import('./uiStore');

    expect(initialConversationUiState.autoReliabilityEnabled).toBe(false);
    expect(useConversationUiStore.getState().autoReliabilityEnabled).toBe(false);
    localStorage.removeItem('autoReliabilityEnabled');
    useConversationUiStore.getState().setAutoReliabilityEnabled(true);
    expect(localStorage.getItem('autoReliabilityEnabled')).toBeNull();
  });

  it('starts collapsed and persists coordinated panel and bounded width preferences', async () => {
    const { useConversationUiStore: store, readContextPanelPreferences } = await import('./uiStore');
    expect(store.getState().contextPanel).toBeNull();
    expect(store.getState().outlineCollapsed).toBe(true);
    store.getState().setContextPanel('outline');
    store.getState().setContextPanelWidth(380);
    expect(readContextPanelPreferences()).toEqual({ contextPanel: 'outline', contextPanelWidth: 380, outlineCollapsed: false });
    store.getState().setContextPanel('work');
    expect(store.getState().outlineCollapsed).toBe(true);
    store.getState().setContextPanel('files');
    expect(readContextPanelPreferences().contextPanel).toBe('files');
    store.getState().setContextPanelWidth(1000);
    expect(store.getState().contextPanelWidth).toBe(480);
    store.getState().setOutlineCollapsed(false);
    expect(store.getState().contextPanel).toBe('outline');
    store.getState().setOutlineCollapsed(true);
    expect(readContextPanelPreferences().contextPanel).toBeNull();
  });

  it('recovers from invalid stored preferences', async () => {
    localStorage.setItem('conversation.contextPanel', 'broken');
    const { readContextPanelPreferences } = await import('./uiStore');
    expect(readContextPanelPreferences()).toEqual({ contextPanel: null, contextPanelWidth: 320, outlineCollapsed: true });
  });
});

describe('conversation asset selection', () => {
  it('does not clear a removed and re-added ref or another actor after an earlier send', async () => {
    const { useConversationUiStore: store, initialConversationUiState } = await import('./uiStore');
    store.setState(initialConversationUiState);
    store.getState().addAssetSelection('alice', 'c1', 'same-ref', 'same.pdf');
    const submitted = store.getState().selectedAssets!.items[0].nonce;
    store.getState().removeAssetSelection('alice', 'c1', submitted);
    store.getState().addAssetSelection('alice', 'c1', 'same-ref', 'same.pdf');
    store.getState().clearSubmittedAssets('alice', 'c1', [submitted]);
    expect(store.getState().selectedAssets?.items).toHaveLength(1);
    store.getState().scopeAssetSelection('bob', 'c2');
    store.getState().addAssetSelection('bob', 'c2', 'bob-ref', 'same.pdf');
    store.getState().clearSubmittedAssets('alice', 'c1', [submitted]);
    expect(store.getState().selectedAssets).toMatchObject({ actorId: 'bob', conversationId: 'c2', items: [{ ref: 'bob-ref' }] });
  });
});

it('keeps only the latest refinement source and renews its submission nonce', async () => {
  const { useConversationUiStore: store, initialConversationUiState } = await import('./uiStore');
  store.setState(initialConversationUiState);
  store.getState().addAssetSelection('alice', 'c1', 'first', 'First', 'answer-1');
  const firstNonce = store.getState().selectedAssets!.items[0].nonce;
  store.getState().addAssetSelection('alice', 'c1', 'second', 'Second', 'answer-2');
  expect(store.getState().selectedAssets!.items.map(item => item.sourceMessageId)).toEqual([undefined, 'answer-2']);
  store.getState().addAssetSelection('alice', 'c1', 'first', 'First', 'answer-1');
  store.getState().clearSubmittedAssets('alice', 'c1', [firstNonce]);
  expect(store.getState().selectedAssets!.items).toHaveLength(2);
  expect(store.getState().selectedAssets!.items.filter(item => item.sourceMessageId)).toMatchObject([{ ref: 'first', sourceMessageId: 'answer-1' }]);
});
