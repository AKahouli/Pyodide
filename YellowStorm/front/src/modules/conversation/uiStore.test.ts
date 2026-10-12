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
