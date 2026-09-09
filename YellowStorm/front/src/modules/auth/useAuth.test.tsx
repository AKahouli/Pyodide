import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { AuthContext } from './AuthContext';
import type { AuthContextType } from './types';
import { useAuth } from './useAuth';

const authContextMock: AuthContextType = {
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
};

describe('useAuth', () => {
  it('throws when used outside AuthProvider', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useAuth())).toThrow('useAuth must be used within an AuthProvider');
    consoleErrorSpy.mockRestore();
  });

  it('returns auth context value when provider exists', () => {
    const wrapper = ({ children }: { children: ReactNode }) => (
      <AuthContext.Provider value={authContextMock}>{children}</AuthContext.Provider>
    );

    const { result } = renderHook(() => useAuth(), { wrapper });
    expect(result.current).toBe(authContextMock);
  });
});
