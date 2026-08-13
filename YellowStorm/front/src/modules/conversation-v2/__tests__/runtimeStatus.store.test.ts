import { describe, expect, it, beforeEach } from 'vitest';
import { useConversationV2Store } from '../store';
import {
  isRuntimePreviewVisible,
  mapHostStatusToRuntimeUi,
} from '../runtime/runtime.types';

describe('conversation-v2 runtimeStatus store', () => {
  beforeEach(() => {
    useConversationV2Store.getState().reset();
  });

  it('defaults to idle and never stores ticket/mcpToken keys', () => {
    const state = useConversationV2Store.getState();
    expect(state.runtimeStatus).toBe('idle');
    expect(state).not.toHaveProperty('ticket');
    expect(state).not.toHaveProperty('mcpToken');
    expect(JSON.stringify(state)).not.toContain('mcpToken');
  });

  it('setRuntimeStatus opens the app panel from closed', () => {
    useConversationV2Store.getState().setRuntimeStatus('browser_active');
    expect(useConversationV2Store.getState().runtimeStatus).toBe('browser_active');
    expect(useConversationV2Store.getState().rightPanelMode).toBe('app');
  });

  it('setRuntimeStatus does not clobber an open tool panel', () => {
    useConversationV2Store.setState({
      rightPanelMode: 'tool',
      selectedToolCallId: 'tc_1',
    });
    useConversationV2Store.getState().setRuntimeStatus('hydrating');
    expect(useConversationV2Store.getState().rightPanelMode).toBe('tool');
  });

  it('reset clears runtimeStatus to idle', () => {
    useConversationV2Store.getState().setRuntimeStatus('error');
    useConversationV2Store.getState().reset();
    expect(useConversationV2Store.getState().runtimeStatus).toBe('idle');
  });
});

describe('mapHostStatusToRuntimeUi', () => {
  it.each([
    ['idle', 'idle'],
    ['connecting', 'connecting'],
    ['registering', 'connecting'],
    ['hydrating', 'hydrating'],
    ['installing', 'hydrating'],
    ['starting', 'hydrating'],
    ['ready', 'browser_active'],
    ['disconnected', 'offline'],
    ['error', 'error'],
  ] as const)('maps %s → %s', (host, ui) => {
    expect(mapHostStatusToRuntimeUi(host)).toBe(ui);
  });
});

describe('isRuntimePreviewVisible', () => {
  it('is true for active runtime statuses', () => {
    expect(isRuntimePreviewVisible('connecting')).toBe(true);
    expect(isRuntimePreviewVisible('hydrating')).toBe(true);
    expect(isRuntimePreviewVisible('browser_active')).toBe(true);
    expect(isRuntimePreviewVisible('offline')).toBe(true);
    expect(isRuntimePreviewVisible('error')).toBe(true);
  });

  it('is false for idle', () => {
    expect(isRuntimePreviewVisible('idle')).toBe(false);
  });
});
