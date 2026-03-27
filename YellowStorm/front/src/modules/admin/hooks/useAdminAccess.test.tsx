import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useAdminAccess } from './useAdminAccess';

const hasAnyPermissionMock = vi.hoisted(() => vi.fn());

vi.mock('./usePermissions', () => ({
  usePermissions: () => ({ hasAnyPermission: hasAnyPermissionMock }),
}));

describe('useAdminAccess', () => {
  it('computes admin access and filters menu items by permissions', () => {
    hasAnyPermissionMock.mockImplementation((required: string[]) =>
      required.includes('admin.*') || required.includes('users.read') || required.includes('*'),
    );

    const { result } = renderHook(() => useAdminAccess());

    expect(result.current.hasAdminAccess).toBe(true);
    expect(result.current.accessibleMenuItems.length).toBeGreaterThan(0);
    expect(result.current.accessibleMenuItems.some((item) => item.id === 'users')).toBe(true);
  });
});
