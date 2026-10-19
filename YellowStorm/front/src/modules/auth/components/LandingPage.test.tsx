import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { makeAuthState } from '../test-utils';
import { useAuthModalStore } from '../store';
import { LandingPage } from './LandingPage';

const useAuthMock = vi.hoisted(() => vi.fn());
const localizationState = vi.hoisted(() => ({ ready: true }));
const getAuthProvidersMock = vi.hoisted(() => vi.fn());

vi.mock('@/modules/auth/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (key: string) => key,
    ready: localizationState.ready,
    language: 'en',
  }),
}));
vi.mock('@/modules/conversation/effects/stars-background', () => ({
  StarsBackground: () => <div data-testid='stars-bg' />,
}));
vi.mock('@/components/AppBrandLogo', () => ({
  AppBrandLogo: ({ className }: { className?: string }) => <div data-testid='app-logo' className={className}>logo</div>,
}));
vi.mock('../modals/AuthModals', () => ({ AuthModals: () => <div data-testid='auth-modals' /> }));
vi.mock('../api', () => ({
  getAuthProviders: getAuthProvidersMock,
}));
vi.mock('@/lib/api/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api/config')>();
  return {
    ...actual,
    API_CONFIG: { ...actual.API_CONFIG, baseURL: 'http://localhost:3000/api/v1' },
    isApiConfigured: () => true,
  };
});

const classicProvider = {
  type: 'classic' as const,
  providerKey: 'classic',
  displayName: 'Email & Password',
  iconKey: 'email',
  sortOrder: 999,
  registrationEnabled: true,
};

const oauthProvider = {
  type: 'oauth' as const,
  providerKey: 'microsoft',
  displayName: 'Microsoft',
  iconKey: 'microsoft',
  sortOrder: 0,
};

describe('LandingPage', () => {
  const renderPage = () =>
    render(
      <MemoryRouter>
        <LandingPage />
      </MemoryRouter>,
    );

  beforeEach(() => {
    vi.clearAllMocks();
    localizationState.ready = true;
    useAuthModalStore.setState({ activeModal: null, registerSuccess: false, registeredEmail: '' });
    useAuthMock.mockReturnValue(makeAuthState({ registrationEnabled: true }));
    getAuthProvidersMock.mockResolvedValue([oauthProvider, classicProvider]);
  });

  it('renders null while translations are not ready', () => {
    localizationState.ready = false;
    const { container } = renderPage();
    expect(container.firstChild).toBeNull();
  });

  it('hides sign up entry when registration is disabled', async () => {
    useAuthMock.mockReturnValue(makeAuthState({ registrationEnabled: false }));

    renderPage();

    // Wait for providers to load
    await screen.findByRole('button', { name: 'landing.emailLogin' }, { timeout: 5000 });
    expect(screen.queryByText('landing.signUp')).not.toBeInTheDocument();
  });

  it('opens login modal on email login click', async () => {
    renderPage();

    // Wait for providers to load (classic provider enables the email button)
    const emailButton = await screen.findByRole('button', { name: 'landing.emailLogin' }, { timeout: 5000 });
    await userEvent.click(emailButton);
    expect(useAuthModalStore.getState().activeModal).toBe('login');
  });

  it('opens register modal on sign up click', async () => {
    renderPage();

    // Wait for providers to load (classic provider enables sign up link)
    const signUpButton = await screen.findByRole('button', { name: 'landing.signUp' }, { timeout: 5000 });
    await userEvent.click(signUpButton);
    expect(useAuthModalStore.getState().activeModal).toBe('register');
  });

  it('hides email login button when no classic provider returned', async () => {
    getAuthProvidersMock.mockResolvedValue([oauthProvider]);

    renderPage();

    // Wait for providers to load
    await vi.waitFor(() => {
      expect(screen.queryByRole('button', { name: 'landing.emailLogin' })).not.toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('renders oauth provider buttons from unified response', async () => {
    renderPage();

    await vi.waitFor(() => {
      expect(screen.getByText('landing.oauthLogin')).toBeInTheDocument();
    }, { timeout: 5000 });
  });

  it('shows loading state while providers are being fetched', () => {
    // Make the promise never resolve during this test
    getAuthProvidersMock.mockReturnValue(new Promise(() => {}));

    renderPage();

    // Title and buttons should NOT be visible during loading
    expect(screen.queryByText('landing.title')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'landing.emailLogin' })).not.toBeInTheDocument();
  });

  it('shows empty state when no providers are enabled', async () => {
    getAuthProvidersMock.mockResolvedValue([]);

    renderPage();

    await vi.waitFor(() => {
      expect(screen.getByText('landing.noProviders')).toBeInTheDocument();
      expect(screen.getByText('landing.noProvidersHint')).toBeInTheDocument();
    }, { timeout: 5000 });
  });
});
