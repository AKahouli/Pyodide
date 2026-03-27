import { LoginModal } from './LoginModal';
import { RegisterModal } from './RegisterModal';
import { ForgotPasswordModal } from './ForgotPasswordModal';
import { useAuthModalStore } from '../../store';

export function AuthModals() {
  const activeModal = useAuthModalStore((state) => state.activeModal);
  const setActiveModal = useAuthModalStore((state) => state.setActiveModal);

  const handleLoginOpenChange = (open: boolean) => {
    setActiveModal(open ? 'login' : null);
  };

  const handleRegisterOpenChange = (open: boolean) => {
    setActiveModal(open ? 'register' : null);
  };

  const handleForgotPasswordOpenChange = (open: boolean) => {
    setActiveModal(open ? 'forgotPassword' : null);
  };

  const handleSwitchToRegister = () => {
    setActiveModal('register');
  };

  const handleSwitchToLogin = () => {
    setActiveModal('login');
  };

  const handleSwitchToForgotPassword = () => {
    setActiveModal('forgotPassword');
  };

  const handleBackToLogin = () => {
    setActiveModal('login');
  };

  return (
    <>
      <LoginModal open={activeModal === 'login'} onOpenChange={handleLoginOpenChange} onSwitchToRegister={handleSwitchToRegister} onForgotPassword={handleSwitchToForgotPassword} />
      <RegisterModal open={activeModal === 'register'} onOpenChange={handleRegisterOpenChange} onSwitchToLogin={handleSwitchToLogin} />
      <ForgotPasswordModal open={activeModal === 'forgotPassword'} onOpenChange={handleForgotPasswordOpenChange} onBackToLogin={handleBackToLogin} />
    </>
  );
}
