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
});
