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
  /** Super-admin invitation token carried by the invite link, if any. */
  inviteToken: string | null;
  /** Address bound to the invitation; pre-filled and locked in the register form. */
  inviteEmail: string | null;
  setActiveModal: (modal: AuthModalType) => void;
  setRegisterSuccess: (success: boolean) => void;
  setRegisteredEmail: (email: string) => void;
  setInvite: (token: string | null, email: string | null) => void;
  resetModalState: () => void;
}

export const useAuthModalStore = create<AuthModalState>()(
  devtools(
    (set) => ({
      activeModal: null,
      registerSuccess: false,
      registeredEmail: '',
      inviteToken: null,
      inviteEmail: null,

      setActiveModal: (modal) => set({ activeModal: modal }),
      setRegisterSuccess: (success) => set({ registerSuccess: success }),
      setRegisteredEmail: (email) => set({ registeredEmail: email }),
      setInvite: (inviteToken, inviteEmail) => set({ inviteToken, inviteEmail }),
      resetModalState: () => set({ activeModal: null, registerSuccess: false, registeredEmail: '', inviteToken: null, inviteEmail: null }),
    }),
    { name: 'auth-modal-store' },
  ),
);
