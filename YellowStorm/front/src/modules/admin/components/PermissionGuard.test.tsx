import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PermissionGuard } from './PermissionGuard';

const hasAnyPermissionMock = vi.hoisted(() => vi.fn());

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: vi.fn(),
    hasAnyPermission: hasAnyPermissionMock,
    hasAllPermissions: vi.fn(),
    permissions: [],
  }),
}));

vi.mock('react-router-dom', () => ({
  Navigate: ({ to }: { to: string }) => <div data-testid="redirect">redirect-{to}</div>,
}));

describe('PermissionGuard', () => {
  it('renders children when user has required permissions', () => {
    hasAnyPermissionMock.mockReturnValue(true);

    render(
      <PermissionGuard permissions={['users.read', 'users.*', '*']}>
        <div>Protected Content</div>
      </PermissionGuard>,
    );

    expect(screen.getByText('Protected Content')).toBeInTheDocument();
    expect(screen.queryByTestId('redirect')).not.toBeInTheDocument();
  });

  it('redirects to /admin when user lacks permissions', () => {
    hasAnyPermissionMock.mockReturnValue(false);

    render(
      <PermissionGuard permissions={['users.read', 'users.*', '*']}>
        <div>Protected Content</div>
      </PermissionGuard>,
    );

    expect(screen.queryByText('Protected Content')).not.toBeInTheDocument();
    expect(screen.getByText('redirect-/admin')).toBeInTheDocument();
  });

  it('passes the correct permissions to hasAnyPermission', () => {
    hasAnyPermissionMock.mockReturnValue(true);
    const permissions = ['plans.read_all', 'plans.*', '*'];

    render(
      <PermissionGuard permissions={permissions}>
        <div>Plans Page</div>
      </PermissionGuard>,
    );

    expect(hasAnyPermissionMock).toHaveBeenCalledWith(permissions);
  });
});
