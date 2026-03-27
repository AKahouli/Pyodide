/**
 * useApiAction hook
 * Provides loading, error, and success states for API calls
 * Supports both toast notifications and inline error display
 */

import { useState, useCallback } from 'react';
import { ApiError, parseApiError, handleApiError } from './api-error';
import { showSuccess } from './notifications';

interface UseApiActionOptions<T> {
  /** Show toast on error (default: true) */
  showErrorToast?: boolean;
  /** Show toast on success (default: false) */
  showSuccessToast?: boolean;
  /** Success message for toast */
  successMessage?: string | ((data: T) => string);
  /** Callback when re-auth is required */
  onReAuthRequired?: () => void;
  /** Callback on success */
  onSuccess?: (data: T) => void;
  /** Callback on error */
  onError?: (error: ApiError) => void;
}

interface UseApiActionReturn<T, Args extends unknown[]> {
  /** Execute the API action */
  execute: (...args: Args) => Promise<T | undefined>;
  /** Whether the action is in progress */
  isLoading: boolean;
  /** The error from the last execution, if any */
  error: ApiError | null;
  /** Clear the current error */
  clearError: () => void;
  /** Whether the last execution was successful */
  isSuccess: boolean;
  /** The data from the last successful execution */
  data: T | null;
  /** Reset all state */
  reset: () => void;
}

/**
 * Hook for handling API actions with loading, error, and success states
 *
 * @example
 * // Basic usage with toast
 * const { execute, isLoading, error } = useApiAction(api.updateProfile, {
 *   showSuccessToast: true,
 *   successMessage: 'Profile updated successfully',
 * });
 *
 * // Inline error display
 * const { execute, isLoading, error } = useApiAction(api.login, {
 *   showErrorToast: false, // Don't show toast, use inline error
 * });
 *
 * // With callbacks
 * const { execute } = useApiAction(api.deleteAccount, {
 *   onSuccess: () => navigate('/'),
 *   onReAuthRequired: () => logout(),
 * });
 */
export function useApiAction<T, Args extends unknown[]>(
  action: (...args: Args) => Promise<T>,
  options?: UseApiActionOptions<T>
): UseApiActionReturn<T, Args> {
  const {
    showErrorToast = true,
    showSuccessToast = false,
    successMessage,
    onReAuthRequired,
    onSuccess,
    onError,
  } = options || {};

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [data, setData] = useState<T | null>(null);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const reset = useCallback(() => {
    setIsLoading(false);
    setError(null);
    setIsSuccess(false);
    setData(null);
  }, []);

  const execute = useCallback(
    async (...args: Args): Promise<T | undefined> => {
      setIsLoading(true);
      setError(null);
      setIsSuccess(false);

      try {
        const result = await action(...args);
        setData(result);
        setIsSuccess(true);

        // Show success toast if enabled
        if (showSuccessToast && successMessage) {
          const message =
            typeof successMessage === 'function'
              ? successMessage(result)
              : successMessage;
          showSuccess(message);
        }

        onSuccess?.(result);
        return result;
      } catch (err) {
        const apiError = showErrorToast
          ? handleApiError(err, { showToast: true, onReAuthRequired })
          : parseApiError(err);

        setError(apiError);

        if (!showErrorToast && apiError.requiresReAuth) {
          onReAuthRequired?.();
        }

        onError?.(apiError);
        return undefined;
      } finally {
        setIsLoading(false);
      }
    },
    [action, showErrorToast, showSuccessToast, successMessage, onReAuthRequired, onSuccess, onError]
  );

  return {
    execute,
    isLoading,
    error,
    clearError,
    isSuccess,
    data,
    reset,
  };
}
