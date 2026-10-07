import { describe, expect, it, beforeEach } from 'vitest';
import { useAppBuilderStudioStore } from '../store';
import {
  isRuntimePreviewVisible,
  mapHostStatusToRuntimeUi,
} from '../runtime/runtime.types';

describe('conversation-v2 runtimeStatus store', () => {
  beforeEach(() => {
    useAppBuilderStudioStore.getState().reset();
  });

  it('defaults to idle and never stores ticket/mcpToken keys', () => {
    const state = useAppBuilderStudioStore.getState();
    expect(state.runtimeStatus).toBe('idle');
    expect(state).not.toHaveProperty('ticket');
    expect(state).not.toHaveProperty('mcpToken');
    expect(JSON.stringify(state)).not.toContain('mcpToken');
  });

  it('setRuntimeStatus opens the app panel from closed', () => {
    useAppBuilderStudioStore.getState().setRuntimeStatus('browser_active');
    expect(useAppBuilderStudioStore.getState().runtimeStatus).toBe('browser_active');
    expect(useAppBuilderStudioStore.getState().rightPanelMode).toBe('app');
  });

  it('setRuntimeStatus does not clobber an open tool panel', () => {
    useAppBuilderStudioStore.setState({
      rightPanelMode: 'tool',
      selectedToolCallId: 'tc_1',
    });
    useAppBuilderStudioStore.getState().setRuntimeStatus('hydrating');
    expect(useAppBuilderStudioStore.getState().rightPanelMode).toBe('tool');
  });

  it('reset clears runtimeStatus to idle', () => {
    useAppBuilderStudioStore.getState().setRuntimeStatus('error');
    useAppBuilderStudioStore.getState().reset();
    expect(useAppBuilderStudioStore.getState().runtimeStatus).toBe('idle');
  });

  it('done switches back to the app preview when the runtime is active', () => {
    useAppBuilderStudioStore.setState({
      runtimeStatus: 'browser_active',
      rightPanelMode: 'tool',
      selectedToolCallId: 'tc_finalize',
      streaming: true,
      liveToolCallId: 'tc_finalize',
    });
    useAppBuilderStudioStore.getState().handleEvent({
      type: 'done',
      event_id: 'done-1',
      timestamp: 1,
    });
    const state = useAppBuilderStudioStore.getState();
    expect(state.streaming).toBe(false);
    expect(state.rightPanelMode).toBe('app');
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
