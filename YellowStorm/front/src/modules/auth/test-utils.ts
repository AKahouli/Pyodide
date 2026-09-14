import type { AuthContextType } from './types';

export function makeAuthState(overrides: Partial<AuthContextType> = {}): AuthContextType {
  return {
    user: null,
    isAuthenticated: false,
    isLoading: false,
    requiresEmailVerification: false,
    requiresProfileCompletion: false,
    registrationEnabled: true,
    isAuthTemporarilyUnavailable: false,
    login: async () => undefined,
    register: async () => undefined,
    logout: async () => undefined,
    verifyEmail: async () => undefined,
    resendVerificationEmail: async () => undefined,
    completeProfile: async () => undefined,
    refreshUser: async () => undefined,
    retryRecovery: async () => undefined,
    ...overrides,
  };
}
