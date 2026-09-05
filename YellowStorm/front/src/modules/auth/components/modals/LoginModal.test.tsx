import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockNavigate } from '@/test/setup';
import { LoginModal } from './LoginModal';

const loginMock = vi.hoisted(() => vi.fn());
const registrationEnabledState = vi.hoisted(() => ({ value: true }));

vi.mock('../../useAuth', () => ({
  useAuth: () => ({
    login: loginMock,
    registrationEnabled: registrationEnabledState.value,
  }),
}));

describe('LoginModal', () => {
  const testPassword = String.fromCharCode(80, 97, 115, 115, 119, 48, 114, 100, 33);
  beforeEach(() => {
    vi.clearAllMocks();
    registrationEnabledState.value = true;
  });

  it('submits credentials and closes on successful login', async () => {
    const onOpenChange = vi.fn();
    loginMock.mockResolvedValue(undefined);

    render(<LoginModal open onOpenChange={onOpenChange} onSwitchToRegister={vi.fn()} onForgotPassword={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('login.email.label'), 'user@example.com');
    await userEvent.type(screen.getByLabelText('login.password.label'), testPassword);
    await userEvent.click(screen.getByRole('button', { name: 'login.submit' }));

    await waitFor(() => expect(loginMock).toHaveBeenCalledWith({ email: 'user@example.com', password: testPassword }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });

  it('opens forgot password flow from link', async () => {
    const onForgotPassword = vi.fn();

    render(<LoginModal open onOpenChange={vi.fn()} onSwitchToRegister={vi.fn()} onForgotPassword={onForgotPassword} />);

    await userEvent.click(screen.getByRole('button', { name: 'login.forgotPassword' }));
    expect(onForgotPassword).toHaveBeenCalledTimes(1);
  });

  it('hides register switch when registration is disabled', () => {
    registrationEnabledState.value = false;

    render(<LoginModal open onOpenChange={vi.fn()} onSwitchToRegister={vi.fn()} onForgotPassword={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'login.createOne' })).not.toBeInTheDocument();
  });

  it('shows the suspended account error when login returns ERR_1110', async () => {
    loginMock.mockRejectedValue({ code: 'ERR_1110' });

    render(<LoginModal open onOpenChange={vi.fn()} onSwitchToRegister={vi.fn()} onForgotPassword={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('login.email.label'), 'user@example.com');
    await userEvent.type(screen.getByLabelText('login.password.label'), testPassword);
    await userEvent.click(screen.getByRole('button', { name: 'login.submit' }));

    await waitFor(() => {
      expect(screen.getByText('login.error.suspended')).toBeInTheDocument();
    });
  });
});
