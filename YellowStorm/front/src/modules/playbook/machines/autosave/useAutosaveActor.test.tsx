import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useAutosaveActor } from './useAutosaveActor';

describe('useAutosaveActor', () => {
  it('returns a stable snapshot across re-renders', () => {
    const { result, rerender } = renderHook(({ enabled }) => useAutosaveActor(enabled), {
      initialProps: { enabled: false },
    });
    const first = result.current;
    rerender({ enabled: false });
    rerender({ enabled: false });
    expect(result.current).toBe(first);
  });

  it('exposes a new snapshot when the machine status changes', () => {
    const { result } = renderHook(() => useAutosaveActor(true));
    const first = result.current;
    act(() => result.current.send({ type: 'LOCAL_CHANGE', dirtyVersion: 1 }));
    expect(result.current).not.toBe(first);
    expect(result.current.status).toBe('dirty');
  });
});
