import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useHomeMotion } from './useHomeMotion';

afterEach(() => {
  localStorage.removeItem('yellowmind.home.motion');
  vi.unstubAllGlobals();
});

function reducedMotion() {
  const media = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  return media;
}

describe('homepage animation preference', () => {
  it('respects reduced motion until an explicit choice, and persists that choice', () => {
    reducedMotion();
    const first = renderHook(useHomeMotion);
    expect(first.result.current.enabled).toBe(false);
    act(() => first.result.current.toggle());
    expect(first.result.current.enabled).toBe(true);
    first.unmount();
    const next = renderHook(useHomeMotion);
    expect(next.result.current.enabled).toBe(true);
    act(() => next.result.current.toggle());
    expect(next.result.current.enabled).toBe(false);
  });

  it('follows system changes until overridden and removes its listener', () => {
    const media = reducedMotion();
    const hook = renderHook(useHomeMotion);
    const listener = media.addEventListener.mock.calls[0][1];
    act(() => { media.matches = false; listener(); });
    expect(hook.result.current.enabled).toBe(true);
    act(() => hook.result.current.toggle());
    act(() => { media.matches = true; listener(); });
    act(() => { media.matches = false; listener(); });
    expect(hook.result.current.enabled).toBe(false);
    hook.unmount();
    expect(media.removeEventListener).toHaveBeenCalledWith('change', listener);
  });
});
