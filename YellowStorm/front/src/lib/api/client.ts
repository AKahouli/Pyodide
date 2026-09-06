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
type RefreshSubscriber = {
  onToken: (token: string) => void;
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

function addRefreshSubscriber(subscriber: RefreshSubscriber) {
  refreshSubscribers.push(subscriber);
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

// Request interceptor - Add auth token to requests
apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const token = localStorage.getItem(AUTH_STORAGE_KEYS.accessToken);
    if (token && config.headers) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor - Handle errors and token refresh
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ error: ApiError; code?: string; maintenance?: MaintenanceInfo }>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

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
        // If refresh fails with session invalidated, clear auth and redirect immediately
        if (apiError.code === 'ERR_1107' || apiError.code === 'ERR_1003') {
          safeRedirectToLogin();
        }
        return Promise.reject(apiError);
      }

      if (isRefreshing) {
        return new Promise((resolve, reject) => {
          addRefreshSubscriber({
            onToken: (token: string) => {
              if (originalRequest.headers) {
                originalRequest.headers.Authorization = `Bearer ${token}`;
              }
              resolve(retryRequestAfterRefresh(originalRequest));
            },
            onError: (err: unknown) => {
              // If refresh fails, clear auth and redirect
              safeRedirectToLogin();
              reject(err);
            },
          });
        });
      }

      originalRequest._retry = true;
      isRefreshing = true;

      try {
        const response = await apiClient.post<ApiResponse<{ accessToken: string; expiresIn: number }>>(
          API_ENDPOINTS.auth.refresh
        );

        const { accessToken } = response.data.data;
        localStorage.setItem(AUTH_STORAGE_KEYS.accessToken, accessToken);

        // Reconnect SSE with new token
        notificationsService.reconnectWithNewToken();
        conversationStreamService.reconnectWithNewToken();
        conversationV2StreamService.reconnectWithNewToken();

        if (originalRequest.headers) {
          originalRequest.headers.Authorization = `Bearer ${accessToken}`;
        }

        onRefreshed(accessToken);
        isRefreshing = false;

        return retryRequestAfterRefresh(originalRequest);
      } catch (refreshError) {
        isRefreshing = false;
        onRefreshFailed(refreshError);
        safeRedirectToLogin();
        return Promise.reject(refreshError);
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
