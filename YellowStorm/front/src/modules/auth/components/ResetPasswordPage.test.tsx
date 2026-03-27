import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ResetPasswordPage } from './ResetPasswordPage';

const resetPasswordMock = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({ resetPassword: resetPasswordMock }));

describe('ResetPasswordPage', () => {
  const validToken = 'b'.repeat(64);

  const renderPage = (token?: string) => {
    const url = token ? `/reset-password?token=${token}` : '/reset-password';
    return render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path='/reset-password' element={<ResetPasswordPage />} />
        </Routes>
      </MemoryRouter>,
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();
    resetPasswordMock.mockResolvedValue({ message: 'ok' });
  });

  it('shows no-token state when token is missing', async () => {
    renderPage();

    expect(await screen.findByText('resetPassword.noToken.title')).toBeInTheDocument();
  });

  it('shows error for invalid token format', async () => {
    renderPage('bad');

    expect(await screen.findByText('resetPassword.error.title')).toBeInTheDocument();
    expect(resetPasswordMock).not.toHaveBeenCalled();
  });

  it('shows validation error on password mismatch', async () => {
    renderPage(validToken);

    await userEvent.type(screen.getByLabelText('resetPassword.password.label'), 'Password1');
    await userEvent.type(screen.getByLabelText('resetPassword.confirmPassword.label'), 'Password2');
    await userEvent.click(screen.getByRole('button', { name: 'resetPassword.submit' }));

    expect(await screen.findByText('resetPassword.error.passwordMismatch')).toBeInTheDocument();
  }, 15000);

  it('submits valid password and shows success state', async () => {
    renderPage(validToken);

    await userEvent.type(screen.getByLabelText('resetPassword.password.label'), 'Password1');
    await userEvent.type(screen.getByLabelText('resetPassword.confirmPassword.label'), 'Password1');
    await userEvent.click(screen.getByRole('button', { name: 'resetPassword.submit' }));

    await waitFor(() => expect(resetPasswordMock).toHaveBeenCalledWith(validToken, 'Password1'));
    expect(await screen.findByText('resetPassword.success.title')).toBeInTheDocument();
  });

  it('shows error state when API reset fails', async () => {
    resetPasswordMock.mockRejectedValueOnce(new Error('failed'));

    renderPage(validToken);

    await userEvent.type(screen.getByLabelText('resetPassword.password.label'), 'Password1');
    await userEvent.type(screen.getByLabelText('resetPassword.confirmPassword.label'), 'Password1');
    await userEvent.click(screen.getByRole('button', { name: 'resetPassword.submit' }));

    expect(await screen.findByText('resetPassword.error.title')).toBeInTheDocument();
  });
});
