/**
 * Auth Modal Store
 * Zustand store for auth modal state
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import type { AuthModalType } from './types';

interface AuthModalState {
  activeModal: AuthModalType;
  registerSuccess: boolean;
  registeredEmail: string;
  setActiveModal: (modal: AuthModalType) => void;
  setRegisterSuccess: (success: boolean) => void;
  setRegisteredEmail: (email: string) => void;
  resetModalState: () => void;
}

export const useAuthModalStore = create<AuthModalState>()(
  devtools(
    (set) => ({
      activeModal: null,
      registerSuccess: false,
      registeredEmail: '',
      
      setActiveModal: (modal) => set({ activeModal: modal }),
      setRegisterSuccess: (success) => set({ registerSuccess: success }),
      setRegisteredEmail: (email) => set({ registeredEmail: email }),
      resetModalState: () => set({ activeModal: null, registerSuccess: false, registeredEmail: '' }),
    }),
    { name: 'auth-modal-store' },
  ),
);
