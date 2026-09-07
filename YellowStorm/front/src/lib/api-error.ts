/**
 * API Error handling utilities
 * Parses backend errors and provides display options
 */

import { AxiosError } from "axios";
import { getErrorMessage, requiresReAuth, ErrorCode } from "./error-codes";
import { showError } from "./notifications";
import { toast } from "sonner";

/**
 * Parsed API error structure
 */
export interface ApiError {
  code: string;
  message: string;
  statusCode: number;
  requiresReAuth: boolean;
  raw?: unknown;
}

/**
 * Backend error response structure
 */
interface BackendErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    statusCode: number;
    details?: unknown;
  };
}
type BackendError = {
  code: string;
  message?: string;
  statusCode: number;
  method: string;
  path: string;
  requestId: string;
  timestamp: string;
  details?: unknown;
};

type ClientApiError = {
  code: string;
  message?: string;
  statusCode: number;
  details?: unknown;
};
/**
 * Parse an error into a standardized ApiError
 */
export function parseApiError(error: unknown): ApiError {
  // Handle Axios errors
  if (isAxiosError(error)) {
    const response = error.response?.data as BackendErrorResponse | undefined;

    if (response?.error?.code) {
      const code = response.error.code;
      return {
        code,
        message: getErrorMessage(code),
        statusCode: response.error.statusCode || error.response?.status || 500,
        requiresReAuth: requiresReAuth(code),
        raw: error,
      };
    }

    // Handle network errors
    if (error.code === "ERR_NETWORK") {
      return {
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message:
          "Unable to connect to server. Please check your internet connection.",
        statusCode: 0,
        requiresReAuth: false,
        raw: error,
      };
    }

    // Handle timeout
    if (error.code === "ECONNABORTED") {
      return {
        code: ErrorCode.SERVICE_UNAVAILABLE,
        message: "Request timed out. Please try again.",
        statusCode: 0,
        requiresReAuth: false,
        raw: error,
      };
    }
    // Generic HTTP error
    return {
      code: ErrorCode.INTERNAL_ERROR,
      message: getErrorMessage(ErrorCode.INTERNAL_ERROR),
      statusCode: error.response?.status || 500,
      requiresReAuth: error.response?.status === 401,
      raw: error,
    };
  }

  // The shared Axios client already unwraps non-401 responses into this
  // compact shape. Preserve its domain code instead of showing ERR_1000.
  if (isClientApiError(error)) {
    return {
      code: error.code,
      message: error.message || getErrorMessage(error.code),
      statusCode: error.statusCode,
      requiresReAuth: requiresReAuth(error.code),
      raw: error,
    };
  }

  // Handle Error objects
  if (error instanceof Error) {
    return {
      code: ErrorCode.INTERNAL_ERROR,
      message: error.message || getErrorMessage(ErrorCode.INTERNAL_ERROR),
      statusCode: 500,
      requiresReAuth: false,
      raw: error,
    };
  }
  if (isBackendError(error)) {
    return {
      code: error.code || ErrorCode.INTERNAL_ERROR,
      message: getErrorMessage(error.code || ErrorCode.INTERNAL_ERROR),
      statusCode: error.statusCode || 500,
      requiresReAuth: false,
      raw: error,
    };
  }
  // Handle unknown errors
  return {
    code: ErrorCode.INTERNAL_ERROR,
    message: getErrorMessage(ErrorCode.INTERNAL_ERROR),
    statusCode: 500,
    requiresReAuth: false,
    raw: error,
  };
}

/**
 * Type guard for Axios errors
 */
function isAxiosError(error: unknown): error is AxiosError {
  return (
    typeof error === "object" &&
    error !== null &&
    "isAxiosError" in error &&
    (error as AxiosError).isAxiosError === true
  );
}
function isBackendError(error: unknown): error is BackendError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    "statusCode" in error &&
    "method" in error &&
    "path" in error
  );
}

function isClientApiError(error: unknown): error is ClientApiError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof (error as ClientApiError).code === "string" &&
    "statusCode" in error &&
    typeof (error as ClientApiError).statusCode === "number"
  );
}

/**
 * Handle API error with toast notification
 * Use this when you want to show a toast and optionally handle re-auth
 */
export function handleApiError(
  error: unknown,
  options?: {
    showToast?: boolean;
    onReAuthRequired?: () => void;
  }
): ApiError {
  const { showToast = true, onReAuthRequired } = options || {};
  const apiError = parseApiError(error);

  if (showToast) {
    showError(apiError.message);
  }

  if (apiError.requiresReAuth && onReAuthRequired) {
    onReAuthRequired();
  }

  return apiError;
}

/**
 * Create an error handler function with pre-configured options
 * Useful for consistent error handling across components
 */
export function createErrorHandler(options?: {
  showToast?: boolean;
  onReAuthRequired?: () => void;
}) {
  return (error: unknown) => handleApiError(error, options);
}
