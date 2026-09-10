import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { usePermissions } from './usePermissions';

const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@/modules/auth', () => ({
  useAuth: useAuthMock,
}));

describe('usePermissions', () => {
  it('grants deep wildcard permissions and super-admin wildcard', () => {
    useAuthMock.mockReturnValue({ user: { permissions: ['admin.*'] } });
    const { result, rerender } = renderHook(() => usePermissions());

    expect(result.current.hasPermission('admin.roles.read')).toBe(true);
    expect(result.current.hasPermission('users.read')).toBe(false);

    useAuthMock.mockReturnValue({ user: { permissions: ['*'] } });
    rerender();
    expect(result.current.hasPermission('anything.random')).toBe(true);
  });

  it('does not treat users.* as Super Admin', () => {
    useAuthMock.mockReturnValue({ user: { permissions: ['users.*'] } });
    const { result } = renderHook(() => usePermissions());

    expect(result.current.hasPermission('*')).toBe(false);
    expect(result.current.hasPermission('users.activate')).toBe(true);
  });

  it('supports any/all checks and defaults to empty permissions', () => {
    useAuthMock.mockReturnValue({ user: { permissions: ['users.read', 'plans.create'] } });
    const { result, rerender } = renderHook(() => usePermissions());

    expect(result.current.hasAnyPermission(['users.suspend', 'users.read'])).toBe(true);
    expect(result.current.hasAllPermissions(['users.read', 'plans.create'])).toBe(true);
    expect(result.current.hasAllPermissions(['users.read', 'users.suspend'])).toBe(false);

    useAuthMock.mockReturnValue({ user: null });
    rerender();
    expect(result.current.permissions).toEqual([]);
  });

  it('keeps legacy roles unrestricted and applies configured visibility allowlists', () => {
    useAuthMock.mockReturnValue({ user: { permissions: ['users.read'] } });
    const { result, rerender } = renderHook(() => usePermissions());

    expect(result.current.canUseFeature('workspace')).toBe(true);
    expect(result.current.canSeeMenu('admin')).toBe(true);

    useAuthMock.mockReturnValue({
      user: { permissions: ['feature.workspace', 'menu.restricted'] },
    });
    rerender();

    expect(result.current.canUseFeature('workspace')).toBe(true);
    expect(result.current.canUseFeature('conversation')).toBe(false);
    expect(result.current.canSeeMenu('admin')).toBe(false);
  });

  it('lets the super-admin wildcard bypass configured visibility restrictions', () => {
    useAuthMock.mockReturnValue({
      user: { permissions: ['*', 'feature.restricted', 'menu.restricted'] },
    });
    const { result } = renderHook(() => usePermissions());

    expect(result.current.canUseFeature('conversation')).toBe(true);
    expect(result.current.canSeeMenu('admin')).toBe(true);
  });
});
