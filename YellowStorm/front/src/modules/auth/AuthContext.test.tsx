import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_STORAGE_KEYS } from '@/lib/api';
import { AuthProvider } from './AuthContext';
import type { User } from './types';
import { useAuth } from './useAuth';

const authApiMock = vi.hoisted(() => ({
  getRegistrationStatus: vi.fn(),
  getCurrentUser: vi.fn(),
  refreshToken: vi.fn(),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  verifyEmail: vi.fn(),
  resendVerificationEmail: vi.fn(),
  completeProfile: vi.fn(),
}));

const notificationsServiceMock = vi.hoisted(() => ({
  reconnectWithNewToken: vi.fn(),
}));

vi.mock('./api', () => authApiMock);
vi.mock('@/modules/notifications', () => ({
  notificationsService: notificationsServiceMock,
}));

const baseUser: User = {
  id: 'user-1',
  email: 'user@example.com',
  emailVerified: true,
  profileComplete: true,
  profile: {
    firstName: 'Test',
    lastName: 'User',
    company: 'Yellowsys',
  },
  consents: {
    privacyPolicy: true,
    dataSharing: true,
  },
  status: 'active',
  plan: {
    id: 'plan-1',
    slug: 'free',
    startedAt: new Date().toISOString(),
  },
};

describe('AuthProvider', () => {
  const testPassword = String.fromCharCode(80, 97, 115, 115, 119, 48, 114, 100, 33);
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();

    authApiMock.getRegistrationStatus.mockResolvedValue({ enabled: true });
    authApiMock.getCurrentUser.mockResolvedValue(baseUser);
    authApiMock.login.mockResolvedValue({
      accessToken: 'access-token',
      expiresIn: 3600,
      user: baseUser,
    });
    authApiMock.logout.mockResolvedValue(undefined);
  });

  it('logs in and persists token/user in localStorage', async () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login({ email: 'user@example.com', password: testPassword });
    });

    expect(authApiMock.login).toHaveBeenCalledWith({ email: 'user@example.com', password: testPassword });
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.user?.email).toBe('user@example.com');
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBe('access-token');
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.user)).toBe(JSON.stringify(baseUser));
  });

  it('clears local auth data on logout even if API logout fails', async () => {
    localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, 'old-token');
    localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify(baseUser));
    authApiMock.logout.mockRejectedValueOnce(new Error('network fail'));

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.accessToken)).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.user)).toBeNull();
  });

  it('starts polling getCurrentUser while the signed-in account is inactive', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const inactiveUser = { ...baseUser, status: 'inactive' as const };
    authApiMock.login.mockResolvedValue({
      accessToken: 'access-token',
      expiresIn: 3600,
      user: inactiveUser,
    });
    authApiMock.getCurrentUser.mockResolvedValue({ ...baseUser, status: 'active' });

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login({ email: 'user@example.com', password: testPassword });
    });
    expect(result.current.user?.status).toBe('inactive');

    const poll = setIntervalSpy.mock.calls.find((call) => call[1] === 15_000)?.[0] as
      | (() => void)
      | undefined;
    expect(poll).toBeTypeOf('function');

    await act(async () => {
      poll?.();
    });

    await waitFor(() => expect(result.current.user?.status).toBe('active'));
    setIntervalSpy.mockRestore();
  });
});
