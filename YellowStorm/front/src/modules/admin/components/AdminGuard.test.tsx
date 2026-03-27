import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AdminGuard } from './AdminGuard';

const authState = vi.hoisted(() => ({ isAuthenticated: true, isLoading: false }));
const accessState = vi.hoisted(() => ({ hasAdminAccess: true }));

vi.mock('@/modules/auth', () => ({
  useAuth: () => authState,
}));

vi.mock('../hooks', () => ({
  useAdminAccess: () => accessState,
}));

vi.mock('react-router-dom', () => ({
  Navigate: ({ to }: { to: string }) => <div>redirect-{to}</div>,
  Outlet: () => <div>admin-outlet</div>,
}));

vi.mock('lucide-react', () => ({
  Loader2: () => <span>loader</span>,
}));

describe('AdminGuard', () => {
  it('shows loader, redirects unauthorized users, and renders outlet when allowed', () => {
    authState.isLoading = true;
    const { rerender } = render(<AdminGuard />);
    expect(screen.getByText('loader')).toBeInTheDocument();

    authState.isLoading = false;
    authState.isAuthenticated = false;
    rerender(<AdminGuard />);
    expect(screen.getByText('redirect-/')).toBeInTheDocument();

    authState.isAuthenticated = true;
    accessState.hasAdminAccess = true;
    rerender(<AdminGuard />);
    expect(screen.getByText('admin-outlet')).toBeInTheDocument();
  });
});
