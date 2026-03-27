import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ForgotPasswordModal } from './ForgotPasswordModal';

const forgotPasswordMock = vi.hoisted(() => vi.fn());

vi.mock('../../api', () => ({
  forgotPassword: forgotPasswordMock,
}));

describe('ForgotPasswordModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('submits email and shows success message', async () => {
    forgotPasswordMock.mockResolvedValue(undefined);

    render(<ForgotPasswordModal open onOpenChange={vi.fn()} onBackToLogin={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('forgotPassword.email.label'), 'user@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'forgotPassword.submit' }));

    await waitFor(() => expect(forgotPasswordMock).toHaveBeenCalledWith('user@example.com'));
    expect(await screen.findByText('forgotPassword.success.title')).toBeInTheDocument();
  });

  it('shows rate-limit error for ERR_1007', async () => {
    forgotPasswordMock.mockRejectedValue({ code: 'ERR_1007' });

    render(<ForgotPasswordModal open onOpenChange={vi.fn()} onBackToLogin={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('forgotPassword.email.label'), 'user@example.com');
    await userEvent.click(screen.getByRole('button', { name: 'forgotPassword.submit' }));

    expect(await screen.findByText('forgotPassword.error.rateLimit')).toBeInTheDocument();
  });
});
