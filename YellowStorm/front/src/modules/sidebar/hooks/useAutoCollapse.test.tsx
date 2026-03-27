import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoCollapse } from './useAutoCollapse';

const sidebarState = vi.hoisted(() => ({
  state: 'expanded' as 'expanded' | 'collapsed',
  toggleSidebar: vi.fn(),
}));

vi.mock('@/components/ui/sidebar', () => ({
  useSidebar: () => sidebarState,
}));

describe('useAutoCollapse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sidebarState.state = 'expanded';
  });

  it('auto-collapses when window shrinks while expanded', () => {
    renderHook(() => useAutoCollapse());
    Object.defineProperty(window, 'innerWidth', { value: 900, writable: true });
    window.dispatchEvent(new Event('resize'));

    expect(sidebarState.toggleSidebar).toHaveBeenCalledTimes(1);
  });

  it('does not toggle when already collapsed', () => {
    sidebarState.state = 'collapsed';
    renderHook(() => useAutoCollapse());
    Object.defineProperty(window, 'innerWidth', { value: 900, writable: true });
    window.dispatchEvent(new Event('resize'));

    expect(sidebarState.toggleSidebar).not.toHaveBeenCalled();
  });
});
