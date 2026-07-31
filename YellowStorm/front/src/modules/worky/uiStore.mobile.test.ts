import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkyUiStore } from './uiStore';

beforeEach(() => useWorkyUiStore.getState().reset());

describe('worky ui store mobile flags', () => {
  it('defaults activeSheet to null', () => {
    expect(useWorkyUiStore.getState().activeSheet).toBeNull();
  });

  it('opens and closes a sheet', () => {
    useWorkyUiStore.getState().setActiveSheet('task');
    expect(useWorkyUiStore.getState().activeSheet).toBe('task');
    useWorkyUiStore.getState().setActiveSheet(null);
    expect(useWorkyUiStore.getState().activeSheet).toBeNull();
  });

  it('reset restores mobile defaults', () => {
    useWorkyUiStore.getState().setActiveSheet('task');
    useWorkyUiStore.getState().reset();
    expect(useWorkyUiStore.getState().activeSheet).toBeNull();
  });
});
