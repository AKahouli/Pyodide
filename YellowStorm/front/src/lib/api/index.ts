export { apiClient, AUTH_LOST_EVENT, clearAuthData, refreshAccessToken, scheduleProactiveRefresh } from './client';
export type { ApiError, ApiResponse } from './client';
export {
  AuthTransientError,
  bumpAuthGeneration,
  getAuthGeneration,
  getAuthRecoveryState,
  isDefinitiveAuthFailure,
  isTransientAuthFailure,
  notifyAuthRecovered,
  notifyAuthRecovering,
  notifyAuthUnavailable,
  resetAuthRecovery,
  subscribeAuthRecovery,
} from './authRecovery';
export type { AuthRecoveryState } from './authRecovery';
export { API_CONFIG, AUTH_STORAGE_KEYS, API_ENDPOINTS } from './config';
