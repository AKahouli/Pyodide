/**
 * Auth Context - Manages authentication state and operations
 */

import * as React from 'react';
import { AUTH_LOST_EVENT, AUTH_STORAGE_KEYS, bumpAuthGeneration, clearAuthData,
getAuthGeneration, isTransientAuthFailure, scheduleProactiveRefresh } from '@/lib/api';
import { clearDataGrants } from '@/modules/semantic-model/data-plane/data-access-token';

/**
 * Single credential-clearing seam for this provider: local auth data plus
 * every data-plane grant, so no path can remove credentials while leaving a
 * previous session's grants reusable. (Refresh-failure logout in the shared
 * client additionally dispatches AUTH_LOST_EVENT, which clears grants too.)
 */
function clearCredentials(): void {
  clearAuthData();
  clearDataGrants();
}
import * as authApi from './api';
import type { AuthContextType, AuthState, LoginCredentials, RegisterCredentials, CompleteProfileData, User } from './types';

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
  requiresEmailVerification: false,
  requiresProfileCompletion: false,
  registrationEnabled: true,
  isAuthTemporarilyUnavailable: false,
};

export const AuthContext = React.createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: React.ReactNode;
}
export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = React.useState<AuthState>(initialState);

  const validateStoredSession = React.useCallback(async (): Promise<void> => {
    const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
    const userJson = localStorage.getItem(AUTH_STORAGE_KEYS.user);

    if (token && userJson) {
      let registrationEnabled = true;
      try {
        // Fetch registration status in parallel with auth validation
        const [enabled, userResult] = await Promise.all([
          authApi
            .getAuthProviders()
            .then((providers) => providers.find((p) => p.type === 'classic')?.registrationEnabled ?? false)
            .catch(() => true), // Fail-open
          authApi.getCurrentUser().then(
            (user) => ({ ok: true as const, user }),
            (error: unknown) => ({ ok: false as const, transient: isTransientAuthFailure(error) }),
          ),
        ]);
        registrationEnabled = enabled;

        if (userResult.ok) {
          const user = userResult.user;
          localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify(user));
          setState({
            user,
            isAuthenticated: true,
            isLoading: false,
            requiresEmailVerification: !user.emailVerified,
            requiresProfileCompletion: !user.profileComplete,
            registrationEnabled,
            isAuthTemporarilyUnavailable: false,
          });
          return;
        }

        if (userResult.transient) {
          // Transient bootstrap failure: credentials stay in storage and the
          // UI exposes a retryable connectivity state instead of the login
          // screen. Protected data is not rendered until validation succeeds.
          setState({
            ...initialState,
            isLoading: false,
            registrationEnabled,
            isAuthTemporarilyUnavailable: true,
          });
          return;
        }

        // Definitive denial (the shared axios client already cleared
        // credentials and redirects when refresh is definitively rejected).
        clearCredentials();
        setState({
          ...initialState,
          isLoading: false,
          registrationEnabled,
        });
      } catch {
        clearCredentials();
        setState({ ...initialState, isLoading: false, registrationEnabled });
      }
    } else {
      // No token - guest user, fetch registration status before finishing load.
      // A missing local access token is not proof the HttpOnly refresh cookie
      // is absent; the shared client's 401 flow attempts one coordinated
      // recovery on the first protected dispatch.
      try {
        const providers = await authApi.getAuthProviders();
        const classic = providers.find((p) => p.type === 'classic');
        const registrationEnabled = classic?.registrationEnabled ?? false;
        setState({ ...initialState, isLoading: false, registrationEnabled });
      } catch {
        setState({ ...initialState, isLoading: false, registrationEnabled: true });
      }
    }
  }, []);

  // Initialize auth state from localStorage on mount
  React.useEffect(() => {
    void validateStoredSession();
  }, [validateStoredSession]);

  React.useEffect(() => {
    const onAuthLost = () => setState({ ...initialState, isLoading: false });
    window.addEventListener(AUTH_LOST_EVENT, onAuthLost);
    return () => window.removeEventListener(AUTH_LOST_EVENT, onAuthLost);
  }, []);

  const login = React.useCallback(async (credentials: LoginCredentials): Promise<void> => {
    const response = await authApi.login(credentials);

    // Store access token and user data
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, response.accessToken);
    localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify(response.user));
    scheduleProactiveRefresh(response.accessToken);
    // A new principal must never reuse the previous session's data-plane grants.
    // Grants only here: the fresh credentials above must survive.
    clearDataGrants();

    setState((prev) => ({
      ...prev,
      user: response.user,
      isAuthenticated: true,
      isLoading: false,
      requiresEmailVerification: !response.user.emailVerified,
      requiresProfileCompletion: !response.user.profileComplete,
      isAuthTemporarilyUnavailable: false,
    }));
  }, []);

  const register = React.useCallback(async (credentials: RegisterCredentials): Promise<void> => {
    try {
      await authApi.register(credentials);

      // Registration successful - user needs to verify email before logging in
      // Don't set authenticated state yet
      setState((prev) => ({ ...prev, requiresEmailVerification: true }));
    } catch (error) {
      throw error;
    }
  }, []);

  const logout = React.useCallback(async (): Promise<void> => {
    try {
      await authApi.logout();
    } catch {
      // Even if API call fails, clear local auth data
    } finally {
      // Invalidate any in-flight refresh/recovery so a late response cannot
      // log the user back in after an explicit logout.
      bumpAuthGeneration();
      clearCredentials();
      setState({
        ...initialState,
        isLoading: false,
      });

      // Re-fetch providers to get fresh registrationEnabled state
      try {
        const providers = await authApi.getAuthProviders();
        const classic = providers.find((p) => p.type === 'classic');
        const registrationEnabled = classic?.registrationEnabled ?? false;
        setState((prev) => ({ ...prev, registrationEnabled }));
      } catch {
        // Keep default on failure
      }
    }
  }, []);

  const verifyEmail = React.useCallback(async (token: string): Promise<void> => {
    await authApi.verifyEmail(token);

    setState((prev) => {
      if (prev.user) {
        const updatedUser = { ...prev.user, emailVerified: true };
        localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify(updatedUser));
        return {
          ...prev,
          user: updatedUser,
          requiresEmailVerification: false,
        };
      }
      return {
        ...prev,
        requiresEmailVerification: false,
      };
    });
  }, []);

  const resendVerificationEmail = React.useCallback(async (): Promise<void> => {
    await authApi.resendVerificationEmail();
  }, []);

  const completeProfile = React.useCallback(async (data: CompleteProfileData): Promise<void> => {
    setState((prev) => ({ ...prev, isLoading: true }));

    try {
      const updatedUser = await authApi.completeProfile(data);
      localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify(updatedUser));

      setState((prev) => ({
        ...prev,
        user: updatedUser,
        isLoading: false,
        requiresProfileCompletion: false,
      }));
    } catch (error) {
      setState((prev) => ({ ...prev, isLoading: false }));
      throw error;
    }
  }, []);

  const refreshUser = React.useCallback(async (): Promise<void> => {
    const generationAtStart = getAuthGeneration();
    try {
      const user = await authApi.getCurrentUser();
      if (getAuthGeneration() !== generationAtStart) {
        return;
      }
      localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify(user));

      setState((prev) => ({
        ...prev,
        user,
        isAuthenticated: true,
        isLoading: false,
        requiresEmailVerification: !user.emailVerified,
        requiresProfileCompletion: !user.profileComplete,
      }));
    } catch (error) {
      // If refresh fails, don't change state
      throw error;
    }
  }, []);

  React.useEffect(() => {
    if (!state.isAuthenticated) {
      return;
    }

    const revalidate = () => {
      void refreshUser().catch(() => undefined);
    };
    const onVisibility = () => {
      if (!document.hidden) {
        revalidate();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', revalidate);

    const interval = state.user?.status === 'inactive'
      ? window.setInterval(revalidate, 15_000)
      : null;
    if (interval !== null) {
      revalidate();
    }

    return () => {
      if (interval !== null) {
        window.clearInterval(interval);
      }
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', revalidate);
    };
  }, [state.isAuthenticated, state.user?.status, refreshUser]);

  const retryRecovery = React.useCallback(async (): Promise<void> => {
    setState((prev) => ({ ...prev, isLoading: true }));
    try {
      await validateStoredSession();
    } finally {
      setState((prev) => (prev.isLoading ? { ...prev, isLoading: false } : prev));
    }
  }, [validateStoredSession]);

  const value = React.useMemo<AuthContextType>(
    () => ({
      ...state,
      login,
      register,
      logout,
      verifyEmail,
      resendVerificationEmail,
      completeProfile,
      refreshUser,
      retryRecovery,
    }),
    [state, login, register, logout, verifyEmail, resendVerificationEmail, completeProfile, refreshUser, retryRecovery],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
