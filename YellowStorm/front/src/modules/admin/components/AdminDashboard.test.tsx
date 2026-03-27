import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { AdminDashboard } from './AdminDashboard';

const menuItems = vi.hoisted(() => [
  {
    id: 'users',
    path: '/admin/users',
    labelKey: 'menu.users.label',
    descriptionKey: 'menu.users.description',
    icon: () => <span>users-icon</span>,
  },
]);

vi.mock('../hooks', () => ({
  useAdminAccess: () => ({ accessibleMenuItems: menuItems }),
}));

describe('AdminDashboard', () => {
  it('renders title/description and menu cards', () => {
    render(
      <MemoryRouter>
        <AdminDashboard />
      </MemoryRouter>,
    );

    expect(screen.getByText('dashboard.title')).toBeInTheDocument();
    expect(screen.getByText('dashboard.description')).toBeInTheDocument();
    expect(screen.getByText('menu.users.label')).toBeInTheDocument();
    expect(screen.getByText('menu.users.description')).toBeInTheDocument();
  });
});
