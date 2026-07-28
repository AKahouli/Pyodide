import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { makeAuthState } from '../test-utils';
import { EmailVerificationPage } from './EmailVerificationPage';

const useAuthMock = vi.hoisted(() => vi.fn());
const resendVerificationByTokenMock = vi.hoisted(() => vi.fn());

vi.mock('@/modules/auth/useAuth', () => ({ useAuth: useAuthMock }));
vi.mock('../api', () => ({ resendVerificationByToken: resendVerificationByTokenMock }));
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

describe('EmailVerificationPage', () => {
  const validToken = 'a'.repeat(64);

  const renderPage = (token?: string) => {
    const url = token ? `/verify-email?token=${token}` : '/verify-email';
    return render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path='/verify-email' element={<EmailVerificationPage />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    useAuthMock.mockReturnValue(makeAuthState({ verifyEmail: vi.fn(async () => undefined) }));
    resendVerificationByTokenMock.mockResolvedValue({ message: 'ok' });
  });

  it('shows no-token state when token is missing', async () => {
    renderPage();

    expect(await screen.findByText('verification.noToken.title')).toBeInTheDocument();
  });

  it('shows error for invalid token format without calling verify API', async () => {
    const verifyEmailMock = vi.fn(async () => undefined);
    useAuthMock.mockReturnValue(makeAuthState({ verifyEmail: verifyEmailMock }));

    renderPage('invalid');

    expect(await screen.findByText('verification.error.title')).toBeInTheDocument();
    expect(verifyEmailMock).not.toHaveBeenCalled();
  });

  it('verifies valid token and shows success state', async () => {
    const verifyEmailMock = vi.fn(async () => undefined);
    useAuthMock.mockReturnValue(makeAuthState({ verifyEmail: verifyEmailMock }));

    renderPage(validToken);

    await waitFor(() => expect(verifyEmailMock).toHaveBeenCalledWith(validToken));
    expect(await screen.findByText('verification.success.title')).toBeInTheDocument();
  });

  it('shows already-verified branch without resend action', async () => {
    const verifyEmailMock = vi.fn(async () => {
      throw Object.assign(new Error('already verified'), { code: 'ERR_1115' });
    });
    useAuthMock.mockReturnValue(makeAuthState({ verifyEmail: verifyEmailMock }));

    renderPage(validToken);

    expect(await screen.findByText('verification.success.title')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'verification.error.resend' })).not.toBeInTheDocument();
  });

  it('allows resend verification on generic error', async () => {
    const verifyEmailMock = vi.fn(async () => {
      throw Object.assign(new Error('boom'), { code: 'ERR_9999' });
    });
    useAuthMock.mockReturnValue(makeAuthState({ verifyEmail: verifyEmailMock }));

    renderPage(validToken);

    const resendButton = await screen.findByRole('button', { name: 'verification.error.resend' });
    await userEvent.click(resendButton);

    await waitFor(() => expect(resendVerificationByTokenMock).toHaveBeenCalledWith(validToken));
  });
});
