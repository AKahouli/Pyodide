/**
 * Notification utilities using Sonner
 * Provides toast notifications for success, error, info, and warning messages
 */

import { toast } from 'sonner';

export interface NotificationOptions {
  description?: string;
  duration?: number;
  action?: {
    label: string;
    onClick: () => void;
  };
}

/**
 * Show a success toast notification
 */
export function showSuccess(message: string, options?: NotificationOptions) {
  toast.success(message, {
    description: options?.description,
    duration: options?.duration ?? 4000,
    action: options?.action,
  });
}

/**
 * Show an error toast notification
 */
export function showError(message: string, options?: NotificationOptions) {
  toast.error(message, {
    description: options?.description,
    duration: options?.duration ?? 5000,
    action: options?.action,
  });
}

/**
 * Show an info toast notification
 */
export function showInfo(message: string, options?: NotificationOptions) {
  toast.info(message, {
    description: options?.description,
    duration: options?.duration ?? 4000,
    action: options?.action,
  });
}

/**
 * Show a warning toast notification
 */
export function showWarning(message: string, options?: NotificationOptions) {
  toast.warning(message, {
    description: options?.description,
    duration: options?.duration ?? 5000,
    action: options?.action,
  });
}

/**
 * Show a loading toast that can be updated
 * Returns a function to dismiss or update the toast
 */
export function showLoading(message: string) {
  const toastId = toast.loading(message);

  return {
    dismiss: () => toast.dismiss(toastId),
    success: (newMessage: string) => {
      toast.success(newMessage, { id: toastId });
    },
    error: (newMessage: string) => {
      toast.error(newMessage, { id: toastId });
    },
  };
}

/**
 * Show a promise toast that shows loading, success, and error states
 */
export function showPromise<T>(
  promise: Promise<T>,
  messages: {
    loading: string;
    success: string | ((data: T) => string);
    error: string | ((err: unknown) => string);
  }
) {
  return toast.promise(promise, {
    loading: messages.loading,
    success: messages.success,
    error: messages.error,
  });
}

/**
 * Dismiss all toasts
 */
export function dismissAll() {
  toast.dismiss();
}

export { toast };
