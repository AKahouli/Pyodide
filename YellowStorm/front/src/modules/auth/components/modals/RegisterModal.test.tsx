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

  it('toggles password visibility with the eye button', async () => {
    render(<RegisterModal open onOpenChange={vi.fn()} onSwitchToLogin={vi.fn()} />);

    const passwordInput = screen.getByLabelText('register.password.label');
    expect(passwordInput).toHaveAttribute('type', 'password');

    // First toggle belongs to the password field, second to confirm password.
    await userEvent.click(screen.getAllByRole('button', { name: 'actionShowPassword' })[0]);

    expect(passwordInput).toHaveAttribute('type', 'text');
    expect(screen.getByLabelText('register.confirmPassword.label')).toHaveAttribute('type', 'password');
  });

  it('shows the specific failing condition while typing the password', async () => {
    render(<RegisterModal open onOpenChange={vi.fn()} onSwitchToLogin={vi.fn()} />);

    const passwordField = screen.getByLabelText('register.password.label');

    // "pass" is too short and misses an uppercase letter: the first unmet rule shows live.
    await userEvent.type(passwordField, 'pass');
    expect(await screen.findByText('register.error.passwordMin')).toBeInTheDocument();

    await userEvent.clear(passwordField);
    // "passw0rd" only misses an uppercase letter.
    await userEvent.type(passwordField, 'passw0rd');
    expect(await screen.findByText('register.error.passwordUppercase')).toBeInTheDocument();
    expect(screen.queryByText('register.error.passwordMin')).not.toBeInTheDocument();
  });

  it('clears the password condition once the password is valid', async () => {
    render(<RegisterModal open onOpenChange={vi.fn()} onSwitchToLogin={vi.fn()} />);

    const passwordField = screen.getByLabelText('register.password.label');

    await userEvent.type(passwordField, 'pass');
    expect(await screen.findByText('register.error.passwordMin')).toBeInTheDocument();

    await userEvent.clear(passwordField);
    await userEvent.type(passwordField, testPassword);

    await waitFor(() => expect(screen.queryByText('register.error.passwordMin')).not.toBeInTheDocument());
    expect(screen.queryByText('register.error.passwordUppercase')).not.toBeInTheDocument();
  });

  it('keeps the submit action available and does not call the API for an invalid password', async () => {
    render(<RegisterModal open onOpenChange={vi.fn()} onSwitchToLogin={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('register.email.label'), 'new@example.com');
    await userEvent.type(screen.getByLabelText('register.password.label'), 'passw0rd');
    await userEvent.type(screen.getByLabelText('register.confirmPassword.label'), 'passw0rd');
    await userEvent.click(screen.getByRole('button', { name: 'register.submit' }));

    await waitFor(() => expect(screen.getByText('register.error.passwordUppercase')).toBeInTheDocument());
    expect(registerMock).not.toHaveBeenCalled();
  });

  it('shows the mismatch message while typing a differing confirmation', async () => {
    render(<RegisterModal open onOpenChange={vi.fn()} onSwitchToLogin={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('register.password.label'), testPassword);
    await userEvent.type(screen.getByLabelText('register.confirmPassword.label'), 'Different1');

    expect(await screen.findByText('register.error.passwordMismatch')).toBeInTheDocument();
  });

  it('clears the mismatch message once both passwords match', async () => {
    render(<RegisterModal open onOpenChange={vi.fn()} onSwitchToLogin={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('register.password.label'), testPassword);
    const confirmField = screen.getByLabelText('register.confirmPassword.label');
    await userEvent.type(confirmField, 'Different1');
    expect(await screen.findByText('register.error.passwordMismatch')).toBeInTheDocument();

    await userEvent.clear(confirmField);
    await userEvent.type(confirmField, testPassword);

    await waitFor(() => expect(screen.queryByText('register.error.passwordMismatch')).not.toBeInTheDocument());
  });

  it('reports the mismatch live when the password changes after confirmation', async () => {
    render(<RegisterModal open onOpenChange={vi.fn()} onSwitchToLogin={vi.fn()} />);

    const passwordField = screen.getByLabelText('register.password.label');
    await userEvent.type(passwordField, testPassword);
    await userEvent.type(screen.getByLabelText('register.confirmPassword.label'), testPassword);
    expect(screen.queryByText('register.error.passwordMismatch')).not.toBeInTheDocument();

    await userEvent.clear(passwordField);
    await userEvent.type(passwordField, `${testPassword}x`);

    expect(await screen.findByText('register.error.passwordMismatch')).toBeInTheDocument();
  });

  it('shows a success message once the password meets every requirement', async () => {
    render(<RegisterModal open onOpenChange={vi.fn()} onSwitchToLogin={vi.fn()} />);

    const passwordField = screen.getByLabelText('register.password.label');

    await userEvent.type(passwordField, 'pass');
    expect(screen.queryByText('register.password.valid')).not.toBeInTheDocument();

    await userEvent.clear(passwordField);
    await userEvent.type(passwordField, testPassword);

    expect(await screen.findByText('register.password.valid')).toBeInTheDocument();
    expect(screen.queryByText('register.error.passwordMin')).not.toBeInTheDocument();
  });

  it('shows a success message once both passwords match', async () => {
    render(<RegisterModal open onOpenChange={vi.fn()} onSwitchToLogin={vi.fn()} />);

    await userEvent.type(screen.getByLabelText('register.password.label'), testPassword);
    const confirmField = screen.getByLabelText('register.confirmPassword.label');

    await userEvent.type(confirmField, 'Different1');
    expect(screen.queryByText('register.confirmPassword.match')).not.toBeInTheDocument();

    await userEvent.clear(confirmField);
    await userEvent.type(confirmField, testPassword);

    expect(await screen.findByText('register.confirmPassword.match')).toBeInTheDocument();
    expect(screen.queryByText('register.error.passwordMismatch')).not.toBeInTheDocument();
  });
});
