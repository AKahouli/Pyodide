import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { mockNavigate } from '@/test/setup';
import { makeAuthState } from '../test-utils';
import { ProfileCompletionPage } from './ProfileCompletionPage';

const useAuthMock = vi.hoisted(() => vi.fn());

vi.mock('@/modules/auth/useAuth', () => ({ useAuth: useAuthMock }));
// Avoid icons ↔ ThemeContext ↔ auth barrel circular import during module collection
vi.mock('@/components/icons', () => ({
  Icons: { YellowMind: () => <div>logo</div> },
  AppLogo: ({ className }: { className?: string }) => (
    <div data-testid='app-logo' className={className}>
      logo
    </div>
  ),
}));
vi.mock('@/modules/conversation/effects/stars-background', () => ({
  StarsBackground: () => <div data-testid='stars-bg' />,
}));

describe('ProfileCompletionPage', () => {
  const renderPage = () =>
    render(
      <MemoryRouter>
        <ProfileCompletionPage />
      </MemoryRouter>,
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('redirects to home when user is not authenticated', async () => {
    useAuthMock.mockReturnValue(makeAuthState({ isAuthenticated: false, requiresProfileCompletion: true }));

    renderPage();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'));
  });

  it('redirects to home when profile is already complete', async () => {
    useAuthMock.mockReturnValue(makeAuthState({ isAuthenticated: true, requiresProfileCompletion: false }));

    renderPage();

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'));
  });

  it('submits profile completion form and navigates home', async () => {
    const completeProfileMock = vi.fn(async () => undefined);
    useAuthMock.mockReturnValue(
      makeAuthState({
        isAuthenticated: true,
        requiresProfileCompletion: true,
        completeProfile: completeProfileMock,
      }),
    );

    renderPage();

    await userEvent.type(screen.getByLabelText('profileCompletion.firstName.label'), 'John');
    await userEvent.type(screen.getByLabelText('profileCompletion.lastName.label'), 'Doe');
    await userEvent.type(screen.getByLabelText('profileCompletion.company.label'), 'Acme');
    await userEvent.type(screen.getByLabelText('profileCompletion.role.label'), 'Engineer');
    await userEvent.type(screen.getByLabelText('profileCompletion.description.label'), 'Builds things');
    await userEvent.click(screen.getAllByRole('checkbox')[0]);
    await userEvent.click(screen.getByRole('button', { name: 'profileCompletion.submit' }));

    await waitFor(() =>
      expect(completeProfileMock).toHaveBeenCalledWith({
        firstName: 'John',
        lastName: 'Doe',
        company: 'Acme',
        role: 'Engineer',
        description: 'Builds things',
        privacyPolicy: true,
        dataSharing: false,
      }),
    );
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'));
  }, 15000);

  it('logs out and navigates home from logout button', async () => {
    const logoutMock = vi.fn(async () => undefined);
    useAuthMock.mockReturnValue(
      makeAuthState({
        isAuthenticated: true,
        requiresProfileCompletion: true,
        logout: logoutMock,
      }),
    );

    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'profileCompletion.logout' }));

    await waitFor(() => expect(logoutMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'));
  });
});
