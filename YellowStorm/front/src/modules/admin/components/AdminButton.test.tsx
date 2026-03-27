import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AdminButton } from './AdminButton';

const accessState = vi.hoisted(() => ({ hasAdminAccess: true }));

vi.mock('../hooks', () => ({
  useAdminAccess: () => accessState,
}));

vi.mock('@/components/ui/sidebar', () => ({
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('lucide-react', () => ({
  Shield: () => <span>shield</span>,
}));

describe('AdminButton', () => {
  it('renders only when user has admin access', () => {
    accessState.hasAdminAccess = true;
    const { rerender } = render(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminButton />
      </MemoryRouter>,
    );

    expect(screen.getByText('sidebar.admin')).toBeInTheDocument();

    accessState.hasAdminAccess = false;
    rerender(
      <MemoryRouter initialEntries={['/admin']}>
        <AdminButton />
      </MemoryRouter>,
    );

    expect(screen.queryByText('sidebar.admin')).not.toBeInTheDocument();
  });
});
