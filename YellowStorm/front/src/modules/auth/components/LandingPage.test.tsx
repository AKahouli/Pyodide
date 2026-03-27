import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { makeAuthState } from '../test-utils';
import { useAuthModalStore } from '../store';
import { LandingPage } from './LandingPage';

const useAuthMock = vi.hoisted(() => vi.fn());
const localizationState = vi.hoisted(() => ({ ready: true }));

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
vi.mock('@/components/icons', () => ({
  Icons: { YellowMind: () => <div>logo</div> },
  AppLogo: ({ className }: { className?: string }) => <div data-testid='app-logo' className={className}>logo</div>,
}));
vi.mock('../modals/AuthModals', () => ({ AuthModals: () => <div data-testid='auth-modals' /> }));

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
  });

  it('renders null while translations are not ready', () => {
    localizationState.ready = false;
    const { container } = renderPage();
    expect(container.firstChild).toBeNull();
  });

  it('hides sign up entry when registration is disabled', () => {
    useAuthMock.mockReturnValue(makeAuthState({ registrationEnabled: false }));

    renderPage();

    expect(screen.queryByText('landing.signUp')).not.toBeInTheDocument();
  });

  it('opens login modal on email login click', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'landing.emailLogin' }));
    expect(useAuthModalStore.getState().activeModal).toBe('login');
  });

  it('opens register modal on sign up click', async () => {
    renderPage();

    await userEvent.click(screen.getByRole('button', { name: 'landing.signUp' }));
    expect(useAuthModalStore.getState().activeModal).toBe('register');
  });
});
