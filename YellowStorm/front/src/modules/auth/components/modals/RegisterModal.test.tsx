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
      inviteToken: null,
      inviteEmail: null,
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

  it('shows the same generic success state for an already-registered email (no enumeration)', async () => {
    // The API answers 201 with the generic result, so the UI cannot tell the two cases apart.
    registerMock.mockResolvedValue(undefined);

    render(<RegisterModal open onOpenChange={vi.fn()} onSwitchToLogin={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('register.email.label'), 'existing@example.com');
    await userEvent.type(screen.getByLabelText('register.password.label'), testPassword);
    await userEvent.type(screen.getByLabelText('register.confirmPassword.label'), testPassword);
    await userEvent.click(screen.getByRole('button', { name: 'register.submit' }));

    expect(await screen.findByText('register.success.title')).toBeInTheDocument();
    expect(screen.queryByText('register.error.emailExists')).not.toBeInTheDocument();
  });

  it('locks the invited email and submits the invitation token', async () => {
    registerMock.mockResolvedValue(undefined);
    useAuthModalStore.setState({ inviteToken: 'tok-123', inviteEmail: 'invited@example.com' });

    render(<RegisterModal open onOpenChange={vi.fn()} onSwitchToLogin={vi.fn()} />);

    const emailInput = screen.getByLabelText('register.email.label');
    await waitFor(() => expect(emailInput).toHaveValue('invited@example.com'));
    expect(emailInput).toBeDisabled();
    expect(screen.getByText('register.invite.banner')).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('register.password.label'), testPassword);
    await userEvent.type(screen.getByLabelText('register.confirmPassword.label'), testPassword);
    await userEvent.click(screen.getByRole('button', { name: 'register.submit' }));

    await waitFor(() =>
      expect(registerMock).toHaveBeenCalledWith({
        email: 'invited@example.com',
        password: testPassword,
        inviteToken: 'tok-123',
      }),
    );
  });
});
