import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AdminSidebar } from './AdminSidebar';

const menuItems = vi.hoisted(() => [
  {
    id: 'users',
    labelKey: 'menu.users.label',
    path: '/admin/users',
    icon: () => <span>users-icon</span>,
  },
]);

vi.mock('../hooks', () => ({
  useAdminAccess: () => ({ accessibleMenuItems: menuItems }),
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children }: { children: ReactNode }) => <button type='button'>{children}</button>,
}));

vi.mock('@/components/ui/sidebar', () => ({
  Sidebar: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarFooter: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenu: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuItem: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarMenuButton: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  SidebarTrigger: () => <button type='button'>collapse</button>,
}));

vi.mock('lucide-react', () => ({
  ArrowLeft: () => <span>arrow-left</span>,
  LayoutDashboard: () => <span>layout-dashboard</span>,
}));

describe('AdminSidebar', () => {
  it('renders dashboard and accessible menu items', () => {
    render(
      <MemoryRouter initialEntries={['/admin/users']}>
        <AdminSidebar />
      </MemoryRouter>,
    );

    expect(screen.getAllByText('sidebar.dashboard').length).toBeGreaterThan(0);
    expect(screen.getByText('menu.users.label')).toBeInTheDocument();
    expect(screen.getByText('sidebar.back')).toBeInTheDocument();
  });
});
