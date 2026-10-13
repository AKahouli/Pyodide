import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTH_LOST_EVENT, AUTH_STORAGE_KEYS, bumpAuthGeneration, getAccessToken, setAccessToken } from '@/lib/api';
// Read the token through the same mocked barrel AuthContext binds to; a
// direct store import can resolve to a second module instance.
import { AuthProvider } from './AuthContext';
import type { User } from './types';
import { useAuth } from './useAuth';

const authApiMock = vi.hoisted(() => ({
  getRegistrationStatus: vi.fn(),
  getAuthProviders: vi.fn(),
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

const restoreSessionMock = vi.hoisted(() => ({ restoreSessionFromCookie: vi.fn() }));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  restoreSessionFromCookie: restoreSessionMock.restoreSessionFromCookie,
}));

vi.mock('./api', () => authApiMock);
vi.mock('@/modules/notifications', () => ({
  notificationsService: notificationsServiceMock,
}));

const dataGrantsMock = vi.hoisted(() => ({ clearDataGrants: vi.fn() }));
vi.mock('@/modules/semantic-model/data-plane/data-access-token', () => dataGrantsMock);

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
    setAccessToken(null); // memory store is shared across tests in this file
    vi.clearAllMocks();

    authApiMock.getRegistrationStatus.mockResolvedValue({ enabled: true });
    authApiMock.getAuthProviders.mockResolvedValue([
      { type: 'classic', providerKey: 'classic', displayName: 'Classic', iconKey: 'classic', registrationEnabled: true },
    ]);
    authApiMock.getCurrentUser.mockResolvedValue(baseUser);
    authApiMock.login.mockResolvedValue({
      accessToken: 'access-token',
      expiresIn: 3600,
      user: baseUser,
    });
    authApiMock.logout.mockResolvedValue(undefined);
    restoreSessionMock.restoreSessionFromCookie.mockResolvedValue(null);
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
    // The access token stays in memory only - never in web storage.
    expect(getAccessToken()).toBe('access-token');
    expect(localStorage.getItem('yellostorm_access_token')).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.user)).toBe(JSON.stringify(baseUser));
  });

  it('restores the session from the refresh cookie on boot', async () => {
    restoreSessionMock.restoreSessionFromCookie.mockResolvedValue('cookie-token');

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    // The store write itself is runCoordinatedRefresh's job (mocked away
    // here, covered in client.refreshBudget.test.ts).
    expect(result.current.user?.email).toBe(baseUser.email);
  });

  it('stays a guest when the refresh cookie is absent', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(restoreSessionMock.restoreSessionFromCookie).toHaveBeenCalledTimes(1);
    expect(authApiMock.getCurrentUser).not.toHaveBeenCalled();
  });

  it('marks auth temporarily unavailable when cookie restore fails transiently', async () => {
    restoreSessionMock.restoreSessionFromCookie.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthTemporarilyUnavailable).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
    expect(getAccessToken()).toBeNull();
  });

  it('clears local auth data on logout even if API logout fails', async () => {
    setAccessToken('old-token');
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
    expect(getAccessToken()).toBeNull();
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.user)).toBeNull();
  });

  it('clears data-plane grants on explicit logout and on login', async () => {
    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login({ email: 'user@example.com', password: testPassword });
    });
    expect(dataGrantsMock.clearDataGrants).toHaveBeenCalled();

    dataGrantsMock.clearDataGrants.mockClear();
    await act(async () => {
      await result.current.logout();
    });
    expect(dataGrantsMock.clearDataGrants).toHaveBeenCalledTimes(1);
  });

  it('clears data-plane grants on definitive bootstrap denial', async () => {
    setAccessToken('stale-token');
    localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify(baseUser));
    authApiMock.getCurrentUser.mockRejectedValue({ statusCode: 401, code: 'ERR_1001' });

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(getAccessToken()).toBeNull();
    expect(dataGrantsMock.clearDataGrants).toHaveBeenCalled();
  });

  it('updates mounted auth state when the shared client loses the session', async () => {
    setAccessToken('access-token');
    localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify(baseUser));
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    act(() => window.dispatchEvent(new Event(AUTH_LOST_EVENT)));

    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.user).toBeNull();
  });

  it('revalidates an authenticated session when the tab regains focus', async () => {
    setAccessToken('access-token');
    localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify(baseUser));
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    authApiMock.getCurrentUser.mockClear();

    act(() => window.dispatchEvent(new Event('focus')));

    await waitFor(() => expect(authApiMock.getCurrentUser).toHaveBeenCalledTimes(1));
  });

  it('does not restore auth when a stale focus revalidation finishes after auth loss', async () => {
    setAccessToken('access-token');
    localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify(baseUser));
    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });
    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));

    let resolveRevalidation: (user: User) => void = () => undefined;
    authApiMock.getCurrentUser.mockImplementationOnce(() => new Promise<User>((resolve) => {
      resolveRevalidation = resolve;
    }));
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(authApiMock.getCurrentUser).toHaveBeenCalledTimes(2));

    act(() => {
      bumpAuthGeneration();
      window.dispatchEvent(new Event(AUTH_LOST_EVENT));
    });
    expect(result.current.isAuthenticated).toBe(false);

    await act(async () => resolveRevalidation(baseUser));
    expect(result.current.isAuthenticated).toBe(false);
  });

  it('starts polling getCurrentUser while the signed-in account is inactive', async () => {
    const setIntervalSpy = vi.spyOn(window, 'setInterval');
    const inactiveUser = { ...baseUser, status: 'inactive' as const };
    authApiMock.login.mockResolvedValue({
      accessToken: 'access-token',
      expiresIn: 3600,
      user: inactiveUser,
    });
    authApiMock.getCurrentUser.mockResolvedValue(inactiveUser);

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.login({ email: 'user@example.com', password: testPassword });
    });
    await waitFor(() => expect(authApiMock.getCurrentUser).toHaveBeenCalled());
    expect(result.current.user?.status).toBe('inactive');

    const poll = setIntervalSpy.mock.calls.find((call) => call[1] === 15_000)?.[0] as
      | (() => void)
      | undefined;
    expect(poll).toBeTypeOf('function');

    authApiMock.getCurrentUser.mockResolvedValue({ ...baseUser, status: 'active' });
    await act(async () => {
      poll?.();
    });

    await waitFor(() => expect(result.current.user?.status).toBe('active'));
    setIntervalSpy.mockRestore();
  });

  it('replaces a stale local user with registrationApproval from getCurrentUser on refresh', async () => {
    const staleUser = { ...baseUser, status: 'inactive' as const, registrationApproval: 'pending' as const };
    const rejectedUser = { ...baseUser, status: 'inactive' as const, registrationApproval: 'rejected' as const };
    setAccessToken('access-token');
    localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify(staleUser));
    authApiMock.getCurrentUser.mockResolvedValue(rejectedUser);

    const { result } = renderHook(() => useAuth(), {
      wrapper: AuthProvider,
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user?.registrationApproval).toBe('rejected');
  });

  it('preserves credentials and exposes a retryable state on transient bootstrap failure', async () => {
    setAccessToken('access-token');
    localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify(baseUser));
    authApiMock.getCurrentUser.mockRejectedValue({ code: 'ERR_NETWORK', statusCode: 0 });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthTemporarilyUnavailable).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);
    // Credentials must survive a transient failure (F02).
    expect(getAccessToken()).toBe('access-token');
    expect(localStorage.getItem(AUTH_STORAGE_KEYS.user)).toBe(JSON.stringify(baseUser));
  });

  it('recovers authentication when retryRecovery succeeds after a transient failure', async () => {
    setAccessToken('access-token');
    localStorage.setItem(AUTH_STORAGE_KEYS.user, JSON.stringify(baseUser));
    authApiMock.getCurrentUser.mockRejectedValueOnce({ statusCode: 503, code: 'ERR_1008' });

    const { result } = renderHook(() => useAuth(), { wrapper: AuthProvider });

    await waitFor(() => expect(result.current.isAuthTemporarilyUnavailable).toBe(true));

    await act(async () => {
      await result.current.retryRecovery();
    });

    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isAuthTemporarilyUnavailable).toBe(false);
    expect(result.current.user?.email).toBe(baseUser.email);
  });
});
