import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkyUiStore } from './uiStore';

beforeEach(() => useWorkyUiStore.getState().reset());

describe('worky ui store mobile flags', () => {
  it('defaults mobileTab to agents and activeSheet to null', () => {
    const s = useWorkyUiStore.getState();
    expect(s.mobileTab).toBe('agents');
    expect(s.activeSheet).toBeNull();
  });

  it('sets the mobile tab', () => {
    useWorkyUiStore.getState().setMobileTab('chat');
    expect(useWorkyUiStore.getState().mobileTab).toBe('chat');
  });

  it('opens and closes a sheet', () => {
    useWorkyUiStore.getState().setActiveSheet('budget');
    expect(useWorkyUiStore.getState().activeSheet).toBe('budget');
    useWorkyUiStore.getState().setActiveSheet(null);
    expect(useWorkyUiStore.getState().activeSheet).toBeNull();
  });

  it('reset restores mobile defaults', () => {
    useWorkyUiStore.getState().setMobileTab('more');
    useWorkyUiStore.getState().setActiveSheet('task');
    useWorkyUiStore.getState().reset();
    expect(useWorkyUiStore.getState().mobileTab).toBe('agents');
    expect(useWorkyUiStore.getState().activeSheet).toBeNull();
  });
});
