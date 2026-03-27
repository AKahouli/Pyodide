import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthModalStore } from '../../store';
import { AuthModals } from './AuthModals';

vi.mock('./LoginModal', () => ({
  LoginModal: ({ open, onOpenChange, onSwitchToRegister, onForgotPassword }: { open: boolean; onOpenChange: (open: boolean) => void; onSwitchToRegister: () => void; onForgotPassword: () => void }) => (
    <div>
      <span>login-open:{String(open)}</span>
      <button type='button' onClick={() => onOpenChange(true)}>
        login-open
      </button>
      <button type='button' onClick={() => onOpenChange(false)}>
        login-close
      </button>
      <button type='button' onClick={onSwitchToRegister}>
        to-register
      </button>
      <button type='button' onClick={onForgotPassword}>
        to-forgot
      </button>
    </div>
  ),
}));

vi.mock('./RegisterModal', () => ({
  RegisterModal: ({ open, onOpenChange, onSwitchToLogin }: { open: boolean; onOpenChange: (open: boolean) => void; onSwitchToLogin: () => void }) => (
    <div>
      <span>register-open:{String(open)}</span>
      <button type='button' onClick={() => onOpenChange(false)}>
        register-close
      </button>
      <button type='button' onClick={onSwitchToLogin}>
        to-login
      </button>
    </div>
  ),
}));

vi.mock('./ForgotPasswordModal', () => ({
  ForgotPasswordModal: ({ open, onOpenChange, onBackToLogin }: { open: boolean; onOpenChange: (open: boolean) => void; onBackToLogin: () => void }) => (
    <div>
      <span>forgot-open:{String(open)}</span>
      <button type='button' onClick={() => onOpenChange(false)}>
        forgot-close
      </button>
      <button type='button' onClick={onBackToLogin}>
        back-login
      </button>
    </div>
  ),
}));

describe('AuthModals', () => {
  beforeEach(() => {
    useAuthModalStore.setState({
      activeModal: null,
      registerSuccess: false,
      registeredEmail: '',
    });
  });

  it('passes open state based on active modal', () => {
    useAuthModalStore.setState({ activeModal: 'login' });
    render(<AuthModals />);

    expect(screen.getByText('login-open:true')).toBeInTheDocument();
    expect(screen.getByText('register-open:false')).toBeInTheDocument();
    expect(screen.getByText('forgot-open:false')).toBeInTheDocument();
  });

  it('switches modal state through child callbacks', async () => {
    render(<AuthModals />);

    await userEvent.click(screen.getByRole('button', { name: 'login-open' }));
    expect(useAuthModalStore.getState().activeModal).toBe('login');

    await userEvent.click(screen.getByRole('button', { name: 'to-register' }));
    expect(useAuthModalStore.getState().activeModal).toBe('register');

    await userEvent.click(screen.getByRole('button', { name: 'to-login' }));
    expect(useAuthModalStore.getState().activeModal).toBe('login');

    await userEvent.click(screen.getByRole('button', { name: 'to-forgot' }));
    expect(useAuthModalStore.getState().activeModal).toBe('forgotPassword');

    await userEvent.click(screen.getByRole('button', { name: 'back-login' }));
    expect(useAuthModalStore.getState().activeModal).toBe('login');

    await userEvent.click(screen.getByRole('button', { name: 'login-close' }));
    expect(useAuthModalStore.getState().activeModal).toBeNull();
  });
});
