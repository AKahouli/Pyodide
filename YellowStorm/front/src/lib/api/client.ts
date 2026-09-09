/**
 * API Client with Axios
 * Handles authentication, token refresh, and error handling
 */

import axios, {
  AxiosError,
  AxiosInstance,
  InternalAxiosRequestConfig,
} from 'axios';
import { API_CONFIG, AUTH_STORAGE_KEYS, API_ENDPOINTS } from './config';
import { notificationsService } from '@/modules/notifications';
import { conversationStreamService } from '@/modules/conversation/stream';
import { conversationV2StreamService } from '@/modules/conversation-v2/conversationV2Stream';
import {
  AuthTransientError,
  bumpAuthGeneration,
  getAuthGeneration,
  getAuthRecoveryState,
  isDefinitiveAuthFailure,
  notifyAuthRecovered,
  notifyAuthRecovering,
  notifyAuthUnavailable,
  registerRecoveryProbe,
  resetAuthRecovery,
} from './authRecovery';
import {
  broadcastAuthEvent,
  clearRefreshAttempt,
  keepRefreshAttempt,
  subscribeAuthBroadcast,
  withCrossTabRefreshLock,
} from './crossTabRefresh';

// Types
export interface ApiError {
  code: string;
  message: string;
  statusCode: number;
  details?: Array<{ field: string; message: string }>;
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  timestamp: string;
}

export interface MaintenanceInfo {
  enabled: boolean;
  message: string;
  estimatedEndAt?: string;
}

// Maintenance state storage key
const MAINTENANCE_STORAGE_KEY = 'maintenance_info';

// Token refresh state to prevent multiple simultaneous refresh calls
let isRefreshing = false;
let isRedirecting = false;

// Refresh burst budget (per tab): a transient outage must not tight-loop the
// refresh endpoint; once the burst is exhausted the client enters the
// recoverable-unavailable state and the recovery probe drives revalidation.
const MAX_REFRESH_ATTEMPTS_PER_BURST = 3;
const REFRESH_HTTP_BUDGET_MS = 10_000;
const MAX_WAITING_REFRESH_REQUESTS = 100;
const WAITING_REQUEST_TIMEOUT_MS = 15_000;
const RECOVERY_PROBE_HEADER = 'X-YellowStorm-Recovery-Probe';
let refreshAttemptsInBurst = 0;

type RefreshSubscriber = {
  /** Returns the retried request promise; it resolves the waiting caller. */
  onToken: (token: string) => Promise<unknown>;
  onError: (error: unknown) => void;
};
let refreshSubscribers: RefreshSubscriber[] = [];

function isConversationMessageRequest(request: InternalAxiosRequestConfig): boolean {
  return request.method?.toLowerCase() === 'post'
    && /^\/conversations\/[^/]+\/messages$/.test(request.url ?? '');
}

async function retryRequestAfterRefresh(request: InternalAxiosRequestConfig): Promise<unknown> {
  if (isConversationMessageRequest(request)) {
    // Never wait on the SSE handshake: the POST proceeds and the server
    // replays stream events missed by the (re)connecting pipe.
    conversationStreamService.ensureConnected();
  }

  return apiClient(request);
}

function onRefreshed(token: string) {
  refreshSubscribers.forEach(({ onToken }) => onToken(token));
  refreshSubscribers = [];
}

function onRefreshFailed(error: unknown) {
  refreshSubscribers.forEach(({ onError }) => onError(error));
  refreshSubscribers = [];
}

/** Queue a request behind an in-flight refresh, with caller-cap and bounded wait. */
function addRefreshSubscriber(subscriber: RefreshSubscriber): Promise<unknown> {
  if (refreshSubscribers.length >= MAX_WAITING_REFRESH_REQUESTS) {
    return Promise.reject(
      new AuthTransientError('Too many requests waiting for authentication recovery'),
    );
  }

  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      const index = refreshSubscribers.indexOf(wrapped);
      if (index !== -1) {
        refreshSubscribers.splice(index, 1);
      }
      reject(new AuthTransientError('Timed out waiting for authentication recovery'));
    }, WAITING_REQUEST_TIMEOUT_MS);

    const wrapped: RefreshSubscriber = {
      onToken: (token: string) => {
        window.clearTimeout(timer);
        return Promise.resolve(subscriber.onToken(token)).then(resolve, reject);
      },
      onError: (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    };
    refreshSubscribers.push(wrapped);
  });
}

/** Read the token a request was sent with, to detect a newer published token. */
function tokenUsedBy(request: InternalAxiosRequestConfig): string | null {
  const header = request.headers?.Authorization;
  return typeof header === 'string' && header.startsWith('Bearer ')
    ? header.slice('Bearer '.length)
    : null;
}

function currentStoredToken(): string | null {
  return localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
}

// Create axios instance
const apiClient: AxiosInstance = axios.create({
  baseURL: API_CONFIG.baseURL,
  timeout: API_CONFIG.timeout,
  withCredentials: API_CONFIG.withCredentials,
  headers: {
    'Content-Type': 'application/json',
  },
});

// ---------------------------------------------------------------------------
// Coordinated refresh execution
// ---------------------------------------------------------------------------

const ROTATION_CONFLICT_CODE = 'ERR_1131';

function extractApiErrorCode(error: unknown): string | null {
  if (error && typeof error === 'object') {
    const candidate = error as { code?: string };
    if (typeof candidate.code === 'string') {
      return candidate.code;
    }
  }
  return null;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/**
 * Execute one refresh under the cross-tab lock. Inside the lock we re-check
 * whether another tab already published a newer token (skip rotation), send
 * the persisted attempt id, and retry a rotation conflict once with the SAME
 * identity so the server receipt path can serve the committed successor.
 */
async function runCoordinatedRefresh(usedToken: string | null): Promise<string> {
  return withCrossTabRefreshLock(async () => {
    const generationAtStart = getAuthGeneration();

    // Another tab may have completed recovery while this caller waited.
    const storedNow = currentStoredToken();
    if (usedToken && storedNow && usedToken !== storedNow) {
      clearRefreshAttempt();
      return storedNow;
    }

    const attemptId = keepRefreshAttempt();
    const postRefresh = () =>
      apiClient.post<ApiResponse<{ accessToken: string; expiresIn: number }>>(
        API_ENDPOINTS.auth.refresh,
        null,
        { timeout: REFRESH_HTTP_BUDGET_MS, headers: { 'X-Refresh-Attempt-Id': attemptId } },
      );

    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const response = await postRefresh();
        const { accessToken } = response.data.data;
        if (getAuthGeneration() !== generationAtStart) {
          throw new AuthTransientError('Session changed during refresh');
        }
        localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, accessToken);
        clearRefreshAttempt();
        broadcastAuthEvent('refreshed');
        return accessToken;
      } catch (refreshError) {
        lastError = refreshError;
        if (attempt === 0 && extractApiErrorCode(refreshError) === ROTATION_CONFLICT_CODE) {
          // Rotation committed elsewhere (or response lost): the same attempt
          // id lets the server serve the receipt instead of rotating again.
          await delay(300);
          continue;
        }
        break;
      }
    }
    throw lastError;
  });
}

// Request interceptor - Add auth token to requests
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      config.headers.delete('Content-Type');
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - Handle errors and token refresh
apiClient.interceptors.response.use(
  (response) => {
    // Any authenticated success ends a recovery episode.
    if (getAuthRecoveryState() !== 'idle') {
      notifyAuthRecovered();
    }
    return response;
  },
  async (error: AxiosError<{ error: ApiError; code?: string; maintenance?: MaintenanceInfo }>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // Any well-formed HTTP response proves the server is reachable: the
    // refresh burst budget renews. Without this, three transient refresh
    // failures during an outage would permanently lock this tab out of
    // recovery even after the backend is healthy again.
    if (error.response) {
      refreshAttemptsInBurst = 0;
    }

    // Handle 503 Maintenance Mode
    // Response structure: { success: false, error: { code: 'MAINTENANCE_MODE', ... }, maintenance: {...} }
    const responseData = error.response?.data as { error?: { code?: string }; maintenance?: MaintenanceInfo } | undefined;
    if (error.response?.status === 503 && responseData?.error?.code === 'MAINTENANCE_MODE') {
      const maintenance = responseData.maintenance;
      if (maintenance) {
        // Store maintenance info for the maintenance page
        sessionStorage.setItem(MAINTENANCE_STORAGE_KEY, JSON.stringify(maintenance));
        // Redirect to maintenance page
        window.location.href = '/#/maintenance';
      }
      return Promise.reject(error);
    }

    // Handle 401 Unauthorized - attempt token refresh
    if (error.response?.status === 401 && !originalRequest._retry) {
      // Don't retry auth endpoints — login 401 is invalid credentials, not an expired token
      if (
        originalRequest.url === API_ENDPOINTS.auth.login ||
        originalRequest.url === API_ENDPOINTS.auth.refresh ||
        originalRequest.url?.startsWith(API_ENDPOINTS.auth.verifyEmail) ||
        originalRequest.url === API_ENDPOINTS.auth.resendVerificationPublic
      ) {
        const apiError: ApiError = error.response?.data?.error || {
          code: 'ERR_UNKNOWN',
          message: 'An unexpected error occurred. Please try again.',
          statusCode: error.response?.status || 500,
        };
        // Only a definitive credential/account denial may clear auth.
        if (apiError.code === 'ERR_1107' || apiError.code === 'ERR_1003') {
          resetAuthRecovery();
          bumpAuthGeneration();
          safeRedirectToLogin();
        }
        return Promise.reject(apiError);
      }

      // Another caller may have already published a newer token: retry with
      // it once instead of issuing a redundant refresh.
      const usedToken = tokenUsedBy(originalRequest);
      const storedToken = currentStoredToken();
      if (usedToken && storedToken && usedToken !== storedToken) {
        originalRequest._retry = true;
        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${storedToken}`;
        }
        return retryRequestAfterRefresh(originalRequest);
      }

      if (isRefreshing) {
        originalRequest._retry = true;
        return addRefreshSubscriber({
          onToken: (token: string) => {
            if (originalRequest.headers) {
              originalRequest.headers.Authorization = `Bearer ${token}`;
            }
            return retryRequestAfterRefresh(originalRequest);
          },
          onError: () => {
            // Transient outcomes arrive as AuthTransientError; definitive
            // denials are handled centrally by the refresh owner.
          },
        });
      }

      // The recovery probe must never be locked out by the burst budget: it
      // is already cadence-limited by the foreground recovery loop.
      const isProbeRequest = originalRequest.headers?.[RECOVERY_PROBE_HEADER] === '1';
      // Backpressure for pathological refresh hammering rests on single-flight
      // plus one refresh per natural 401; this budget is a secondary guard
      // that renews whenever any real HTTP response arrives.
      if (refreshAttemptsInBurst >= MAX_REFRESH_ATTEMPTS_PER_BURST && !isProbeRequest) {
        // Budget exhausted without any server response: recoverable state,
        // NOT a logout. The recovery probe revalidates on its own cadence.
        notifyAuthUnavailable();
        return Promise.reject(new AuthTransientError());
      }

      originalRequest._retry = true;
      isRefreshing = true;
      notifyAuthRecovering();

      try {
        const accessToken = await runCoordinatedRefresh(usedToken);
        refreshAttemptsInBurst = 0;

        // Reconnect SSE with new token
        notificationsService.reconnectWithNewToken();
        conversationStreamService.reconnectWithNewToken();
        conversationV2StreamService.reconnectWithNewToken();

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        }

        onRefreshed(accessToken);
        isRefreshing = false;
        notifyAuthRecovered();

        return retryRequestAfterRefresh(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;

        if (isDefinitiveAuthFailure(refreshError)) {
          resetAuthRecovery();
          bumpAuthGeneration();
          clearRefreshAttempt();
          broadcastAuthEvent('logout');
          onRefreshFailed(refreshError);
          safeRedirectToLogin();
          return Promise.reject(refreshError);
        }

        // Transient refresh failure: keep credentials, surface a recoverable
        // error, and let the recovery probe revalidate. Never log out here.
        if (!isProbeRequest) {
          refreshAttemptsInBurst += 1;
        }
        notifyAuthUnavailable();
        const transientError = refreshError instanceof AuthTransientError
          ? refreshError
          : new AuthTransientError();
        onRefreshFailed(transientError);
        return Promise.reject(transientError);
      }
    }

    // Transform error to a consistent format
    const apiError: ApiError = error.response?.data?.error || {
      code: 'ERR_NETWORK',
      message: error.message || 'Network error occurred',
      statusCode: error.response?.status || 500,
    };

    return Promise.reject(apiError);
  }
);

// Helper function to clear auth data
function clearAuthData() {
  resetAuthRecovery();
  localStorage.removeItem(AUTH_STORAGE_KEYS.accessToken);
  localStorage.removeItem(AUTH_STORAGE_KEYS.user);
}

// Helper function to safely redirect to login (prevents multiple redirects)
function safeRedirectToLogin() {
  if (!isRedirecting) {
    isRedirecting = true;
    clearAuthData();
    window.location.href = '/#/';
  }
}

// While in the recoverable-unavailable state, the foreground recovery loop
// probes with a cheap authenticated request. A 401 re-enters the refresh
// flow above (exempt from the burst budget); a success ends the recovery
// episode via the response handler.
registerRecoveryProbe(async () => {
  await apiClient.get(API_ENDPOINTS.users.me, {
    timeout: REFRESH_HTTP_BUDGET_MS,
    headers: { [RECOVERY_PROBE_HEADER]: '1' },
  });
});

// Stale tabs learn about a completed rotation and reconnect their SSE pipes
// with the newer token instead of starting their own rotation.
subscribeAuthBroadcast((type) => {
  if (type === 'refreshed') {
    notificationsService.reconnectWithNewToken();
    conversationStreamService.reconnectWithNewToken();
    conversationV2StreamService.reconnectWithNewToken();
  }
});

// Helper functions for maintenance mode
function getMaintenanceInfo(): MaintenanceInfo | null {
  const stored = sessionStorage.getItem(MAINTENANCE_STORAGE_KEY);
  if (stored) {
    try {
      return JSON.parse(stored) as MaintenanceInfo;
    } catch {
      return null;
    }
  }
  return null;
}

function clearMaintenanceInfo() {
  sessionStorage.removeItem(MAINTENANCE_STORAGE_KEY);
}

// Export the client and helpers
export { apiClient, clearAuthData, getMaintenanceInfo, clearMaintenanceInfo, MAINTENANCE_STORAGE_KEY };
export default apiClient;
