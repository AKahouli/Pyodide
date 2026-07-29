/**
 * Auth Context - Manages authentication state and operations
 */

import * as React from 'react';
import { AUTH_STORAGE_KEYS, getAccessToken, setAccessToken, clearAccessToken } from '@/lib/api';
import * as authApi from './api';
import { notificationsService } from '@/modules/notifications';
import type { AuthContextType, AuthState, LoginCredentials, RegisterCredentials, CompleteProfileData, User } from './types';

const initialState: AuthState = {
  user: null,
  isAuthenticated: false,
  isLoading: true,
  requiresEmailVerification: false,
  requiresProfileCompletion: false,
  registrationEnabled: true,
};

export const AuthContext = React.createContext<AuthContextType | null>(null);

interface AuthProviderProps {
  children: React.ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [state, setState] = React.useState<AuthState>(initialState);
  const [initialColorTheme, setInitialColorTheme] = React.useState<'default' | 'yellow' | 'orange' | 'blue'>('default');

  const fetchGlobalAppearance = React.useCallback(async (): Promise<'default' | 'yellow' | 'orange' | 'blue'> => {
    try {
      const appearance = await authApi.getGlobalAppearanceSettings();
      return appearance.defaultColorTheme;
    } catch {
      return 'default';
    }
  }, []);

  // Initialize auth state from localStorage on mount
  React.useEffect(() => {
    const fetchRegistration = async (): Promise<boolean> => {
      try {
        const providers = await authApi.getAuthProviders();
        const classic = providers.find((p) => p.type === 'classic');
        return classic?.registrationEnabled ?? false;
      } catch {
        return true; // Fail-open
      }
    };

    const initializeAuth = async () => {
      try {
        const globalAppearance = await fetchGlobalAppearance();
        const registrationEnabled = await fetchRegistration();

        const token = getAccessToken();

        if (token) {
          const user = await authApi.getCurrentUser().catch(() => null);

          if (user) {
            setInitialColorTheme(user.appearance?.colorTheme ?? globalAppearance);
            setState({
              user,
              isAuthenticated: true,
              isLoading: false,
              requiresEmailVerification: !user.emailVerified,
              requiresProfileCompletion: !user.profileComplete,
              registrationEnabled,
            });
            return;
          }

          clearAccessToken();
          setInitialColorTheme('default');
          setState({
            ...initialState,
            isLoading: false,
            registrationEnabled,
          });
        } else {
          setInitialColorTheme(globalAppearance);
          setState({ ...initialState, isLoading: false, registrationEnabled });
        }
      } catch {
        clearAccessToken();
        setInitialColorTheme('default');
        setState({ ...initialState, isLoading: false });
      }
    };

    initializeAuth();
  }, []);

  const login = React.useCallback(async (credentials: LoginCredentials): Promise<void> => {
    const response = await authApi.login(credentials);

    setAccessToken(response.accessToken);

    setState((prev) => ({
      ...prev,
      user: response.user,
      isAuthenticated: true,
      isLoading: false,
      requiresEmailVerification: !response.user.emailVerified,
      requiresProfileCompletion: !response.user.profileComplete,
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
      clearAccessToken();
      clearLocalAuthData();
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
    try {
      const user = await authApi.getCurrentUser();
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
    }),
    [state, login, register, logout, verifyEmail, resendVerificationEmail, completeProfile, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Helper function to clear local auth data
function clearLocalAuthData() {
  localStorage.removeItem(AUTH_STORAGE_KEYS.user);
}
