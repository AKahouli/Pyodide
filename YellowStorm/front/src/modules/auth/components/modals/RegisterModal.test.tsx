import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthModalStore } from '../../store';
import { RegisterModal } from './RegisterModal';

const registerMock = vi.hoisted(() => vi.fn());

vi.mock('../../useAuth', () => ({
  useAuth: () => ({ register: registerMock }),
}));

describe('RegisterModal', () => {
  const testPassword = String.fromCharCode(80, 97, 115, 115, 119, 48, 114, 100, 33);
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthModalStore.setState({
      activeModal: null,
      registerSuccess: false,
      registeredEmail: '',
    });
  });

  it('submits registration form and shows success state', async () => {
    registerMock.mockResolvedValue(undefined);

    render(<RegisterModal open onOpenChange={vi.fn()} onSwitchToLogin={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('register.email.label'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('register.password.label'), testPassword);
    await userEvent.type(screen.getByLabelText('register.confirmPassword.label'), testPassword);
    await userEvent.click(screen.getByRole('button', { name: 'register.submit' }));

    await waitFor(() => expect(registerMock).toHaveBeenCalledWith({ email: 'new@example.com', password: testPassword }));
    expect(await screen.findByText('register.success.title')).toBeInTheDocument();
    expect(useAuthModalStore.getState().registerSuccess).toBe(true);
  }, 15000);

  it('shows mapped error when email already exists', async () => {
    registerMock.mockRejectedValue({ code: 'ERR_1101' });

    render(<RegisterModal open onOpenChange={vi.fn()} onSwitchToLogin={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('register.email.label'), 'existing@example.com');
    await userEvent.type(screen.getByLabelText('register.password.label'), testPassword);
    await userEvent.type(screen.getByLabelText('register.confirmPassword.label'), testPassword);
    await userEvent.click(screen.getByRole('button', { name: 'register.submit' }));

    expect(await screen.findByText('register.error.emailExists')).toBeInTheDocument();
  });
});
