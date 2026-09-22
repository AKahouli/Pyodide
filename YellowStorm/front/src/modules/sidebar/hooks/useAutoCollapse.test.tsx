import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutoCollapse } from './useAutoCollapse';

const sidebarState = vi.hoisted(() => ({
  state: 'expanded' as 'expanded' | 'collapsed',
  setOpen: vi.fn(),
  toggleSidebar: vi.fn(),
}));
const locationState = vi.hoisted(() => ({ pathname: '/apps' }));

vi.mock('@/components/ui/sidebar', () => ({
  useSidebar: () => sidebarState,
}));

vi.mock('react-router-dom', () => ({
  useLocation: () => locationState,
}));

function setWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', { value: width, writable: true });
}

describe('useAutoCollapse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sidebarState.state = 'expanded';
    locationState.pathname = '/apps';
    document.cookie = 'sidebar_state=; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    setWidth(1280);
  });

  it.each(['/', '/conversation', '/conversation/conversation-1'])(
    'collapses when entering %s',
    (pathname) => {
      document.cookie = 'sidebar_state=true';
      locationState.pathname = pathname;
      const { rerender } = renderHook(() => useAutoCollapse());

      expect(sidebarState.setOpen).toHaveBeenCalledWith(false);
      sidebarState.setOpen.mockClear();
      rerender();
      expect(sidebarState.setOpen).not.toHaveBeenCalled();
    },
  );

  it('does not collapse Conversation v2', () => {
    document.cookie = 'sidebar_state=true';
    locationState.pathname = '/conversation-v2/session-1';
    renderHook(() => useAutoCollapse());

    expect(sidebarState.setOpen).not.toHaveBeenCalled();
  });

  it('collapses on mount when below 1024px and no persisted state exists', () => {
    setWidth(900);
    renderHook(() => useAutoCollapse());
    expect(sidebarState.setOpen).toHaveBeenCalledWith(false);
  });

  it('respects a persisted cookie on mount instead of the breakpoint', () => {
    document.cookie = 'sidebar_state=false';
    setWidth(1280);
    renderHook(() => useAutoCollapse());
    expect(sidebarState.setOpen).not.toHaveBeenCalled();
  });

  it('collapses when resizing across the breakpoint and expands back', () => {
    renderHook(() => useAutoCollapse());
    sidebarState.setOpen.mockClear();

    setWidth(900);
    window.dispatchEvent(new Event('resize'));
    expect(sidebarState.setOpen).toHaveBeenCalledWith(false);

    // Same-side resize must not fight the user's manual toggle.
    sidebarState.setOpen.mockClear();
    setWidth(800);
    window.dispatchEvent(new Event('resize'));
    expect(sidebarState.setOpen).not.toHaveBeenCalled();

    setWidth(1280);
    window.dispatchEvent(new Event('resize'));
    expect(sidebarState.setOpen).toHaveBeenCalledWith(true);
  });

  it('does not re-apply the rule when setOpen identity changes after a toggle', () => {
    const { rerender } = renderHook(() => useAutoCollapse());
    sidebarState.setOpen.mockClear();

    // Simulate the provider rebuilding setOpen after a toggle (identity churn).
    const nextSetOpen = vi.fn();
    const original = sidebarState.setOpen;
    sidebarState.setOpen = nextSetOpen;
    rerender();

    // No resize, no crossing — the hook must not call setOpen on re-render.
    expect(nextSetOpen).not.toHaveBeenCalled();
    sidebarState.setOpen = original;
  });
});
