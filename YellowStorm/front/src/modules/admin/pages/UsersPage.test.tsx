import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import { renderWithProviders } from '@/test/renderWithProviders';
import { UsersPage } from './UsersPage';
import type { AdminUserResponse } from '../types';

const hasPermissionMock = vi.hoisted(() => vi.fn((permission: string) => permission === '*'));
const translateMock = vi.hoisted(() => (key: string) => key);
const useAuthMock = vi.hoisted(() => vi.fn(() => ({ isAuthenticated: true, user: { id: 'sa', permissions: ['*'] } })));

vi.mock('@/modules/auth/useAuth', () => ({ useAuth: useAuthMock }));

vi.mock('../hooks/usePermissions', () => ({
  usePermissions: () => ({
    hasPermission: hasPermissionMock,
    hasAnyPermission: () => false,
    hasAllPermissions: () => false,
    permissions: [],
  }),
}));

vi.mock('@/modules/localization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/modules/localization')>();
  return { ...actual, useModuleTranslation: () => ({ t: translateMock, ready: true, language: 'en' }) };
});

vi.mock('../api', () => ({
  getAdminUsers: vi.fn(),
  getAdminUserById: vi.fn(),
  suspendUser: vi.fn(),
  activateUser: vi.fn(),
  approveRegistration: vi.fn(),
  rejectRegistration: vi.fn(),
  assignPlanToUser: vi.fn(),
  getAllPlans: vi.fn(),
  getActiveRoles: vi.fn(),
  assignRoleToUser: vi.fn(),
  unassignRoleFromUser: vi.fn(),
}));

import {
  getAdminUsers,
  getAllPlans,
  getActiveRoles,
  approveRegistration,
} from '../api';

const pendingUser: AdminUserResponse = {
  id: 'user-pending',
  email: 'jane@acme.io',
  emailVerified: true,
  profileComplete: false,
  profile: { firstName: 'Jane', lastName: 'Doe' },
  status: 'inactive',
  registrationApproval: 'pending',
  roles: [],
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
};

describe('UsersPage registration review', () => {
  beforeEach(() => {
    hasPermissionMock.mockImplementation((permission: string) => permission === '*');
    vi.mocked(getAdminUsers).mockResolvedValue({
      users: [pendingUser],
      total: 1,
      page: 1,
      limit: 20,
      totalPages: 1,
    });
    vi.mocked(getAllPlans).mockResolvedValue([]);
    vi.mocked(getActiveRoles).mockResolvedValue([]);
    vi.mocked(approveRegistration).mockResolvedValue(undefined);
  });

  it('shows approve and reject for Super Admin on pending inactive users', async () => {
    const { user } = renderWithProviders(<UsersPage />);
    const email = await screen.findByText('jane@acme.io');
    const row = email.closest('tr');
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByRole('button'));

    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('users.dropdown.approveRegistration')).toBeInTheDocument();
    expect(within(menu).getByText('users.dropdown.rejectRegistration')).toBeInTheDocument();
    expect(within(menu).queryByText('users.dropdown.suspend')).not.toBeInTheDocument();
  });

  it('hides registration actions when the actor is not Super Admin', async () => {
    hasPermissionMock.mockReturnValue(false);
    const { user } = renderWithProviders(<UsersPage />);
    const email = await screen.findByText('jane@acme.io');
    const row = email.closest('tr');
    expect(row).not.toBeNull();
    await user.click(within(row as HTMLElement).getByRole('button'));

    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByText('users.dropdown.approveRegistration')).not.toBeInTheDocument();
    expect(within(menu).queryByText('users.dropdown.rejectRegistration')).not.toBeInTheDocument();
  });

  it('opens the approve dialog from a review deep-link', async () => {
    const { user } = renderWithProviders(<UsersPage />, {
      router: { initialEntries: ['/admin/users?status=inactive&review=user-pending&decision=approve'] },
    });

    expect(await screen.findByText('users.modals.approveRegistration.title')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'users.modals.approveRegistration.action' }));
    await waitFor(() => expect(approveRegistration).toHaveBeenCalledWith('user-pending'));
  });
});
