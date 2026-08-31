import { describe, it, expect, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import {
  SIDEBAR_DEFAULT_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  clampSidebarWidth,
  computeDragWidth,
  useResizableSidebar,
} from './useResizableSidebar';

const KEY = 'worky:test-sidebar-width';

describe('resizable sidebar helpers', () => {
  describe('clampSidebarWidth', () => {
    it('keeps in-range widths untouched', () => {
      expect(clampSidebarWidth(400)).toBe(400);
    });
    it('clamps below the minimum', () => {
      expect(clampSidebarWidth(50)).toBe(SIDEBAR_MIN_WIDTH);
    });
    it('clamps above the maximum', () => {
      expect(clampSidebarWidth(5000)).toBe(SIDEBAR_MAX_WIDTH);
    });
  });

  describe('computeDragWidth', () => {
    it('grows the width when the left-edge handle is dragged left (negative delta)', () => {
      expect(computeDragWidth(344, -50)).toBe(394);
    });
    it('shrinks the width when dragged right (positive delta)', () => {
      expect(computeDragWidth(344, 50)).toBe(294);
    });
    it('clamps the dragged result', () => {
      expect(computeDragWidth(344, -100000)).toBe(SIDEBAR_MAX_WIDTH);
    });
  });
});

describe('useResizableSidebar', () => {
  beforeEach(() => localStorage.clear());

  it('starts at the default width when nothing is stored', () => {
    const { result } = renderHook(() => useResizableSidebar(KEY));
    expect(result.current.width).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it('restores a clamped stored width', () => {
    localStorage.setItem(KEY, '9999');
    const { result } = renderHook(() => useResizableSidebar(KEY));
    expect(result.current.width).toBe(SIDEBAR_MAX_WIDTH);
  });

  it('grows on ArrowLeft and shrinks on ArrowRight, persisting the result', () => {
    const { result } = renderHook(() => useResizableSidebar(KEY));

    act(() => {
      result.current.separatorProps.onKeyDown({
        key: 'ArrowLeft',
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent);
    });
    expect(result.current.width).toBeGreaterThan(SIDEBAR_DEFAULT_WIDTH);
    expect(Number(localStorage.getItem(KEY))).toBe(result.current.width);

    const grown = result.current.width;
    act(() => {
      result.current.separatorProps.onKeyDown({
        key: 'ArrowRight',
        preventDefault: () => {},
      } as unknown as React.KeyboardEvent);
    });
    expect(result.current.width).toBeLessThan(grown);
  });

  it('resets to the default width on double-click', () => {
    localStorage.setItem(KEY, '600');
    const { result } = renderHook(() => useResizableSidebar(KEY));
    expect(result.current.width).toBe(600);

    act(() => result.current.separatorProps.onDoubleClick());

    expect(result.current.width).toBe(SIDEBAR_DEFAULT_WIDTH);
    expect(Number(localStorage.getItem(KEY))).toBe(SIDEBAR_DEFAULT_WIDTH);
  });

  it('exposes accessible separator semantics', () => {
    const { result } = renderHook(() => useResizableSidebar(KEY));
    expect(result.current.separatorProps.role).toBe('separator');
    expect(result.current.separatorProps['aria-orientation']).toBe('vertical');
    expect(result.current.separatorProps.tabIndex).toBe(0);
  });
});
