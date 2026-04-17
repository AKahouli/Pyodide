import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { useShallow } from 'zustand/react/shallow';
import { toast } from 'sonner';
import type { ConnectedAppWithStatus, MailboxCapability, OAuthPopupResult } from './types';
import * as api from './api';
import { i18nInstance } from '@/modules/localization/i18nInstance';
import { API_CONFIG } from '@/lib/api/config';

/** Origin that serves the OAuth callback HTML (backend), for postMessage validation */
function getBackendOrigin(): string {
  const base = API_CONFIG.baseURL.replace(/\/api\/v1\/?$/, '');
  try {
    return new URL(base).origin;
  } catch {
    return '';
  }
}

function isTrustedOAuthMessageOrigin(origin: string): boolean {
  if (origin === window.location.origin) return true;
  const backend = getBackendOrigin();
  return Boolean(backend && origin === backend);
}

function tApp(key: string, fallback: string) {
  if (i18nInstance.isInitialized) {
    return i18nInstance.t(key, { ns: 'connected-app', defaultValue: fallback });
  }
  return fallback;
}

// ===== State =====

interface ConnectedAppState {
  apps: ConnectedAppWithStatus[];
  isLoading: boolean;
  isInitialized: boolean;
  connectingAppKey: string | null;
  mailboxCapability: MailboxCapability | null;
}

interface ConnectedAppActions {
  fetchApps: () => Promise<void>;
  connectApp: (appKey: string) => Promise<boolean>;
  disconnectApp: (appKey: string) => Promise<void>;
  fetchMailboxCapability: () => Promise<void>;
  isConnected: (appKey: string) => boolean;
  reset: () => void;
}

type ConnectedAppStore = ConnectedAppState & ConnectedAppActions;

const initialState: ConnectedAppState = {
  apps: [],
  isLoading: false,
  isInitialized: false,
  connectingAppKey: null,
  mailboxCapability: null,
};

// ===== Store =====

export const useConnectedAppStore = create<ConnectedAppStore>()(
  devtools(
    (set, get) => ({
      ...initialState,

      fetchApps: async () => {
        set({ isLoading: true });
        try {
          const [apps, mailboxCapability] = await Promise.all([
            api.getAvailableApps(),
            api.getMailboxCapability().catch(() => null),
          ]);
          set({ apps, mailboxCapability, isLoading: false, isInitialized: true });
        } catch {
          set({ isLoading: false });
          toast.error(tApp('store.errors.fetchFailed', 'Failed to load apps'));
        }
      },

      fetchMailboxCapability: async () => {
        try {
          const mailboxCapability = await api.getMailboxCapability();
          set({ mailboxCapability });
        } catch {
          set({ mailboxCapability: null });
        }
      },

      connectApp: async (appKey: string) => {
        set({ connectingAppKey: appKey });

        try {
          const authUrl = await api.getAuthorizationUrl(appKey);

          const popup = window.open(
            authUrl,
            'connected-app-oauth',
            'width=600,height=700,scrollbars=yes,resizable=yes',
          );

          if (!popup) {
            toast.error(
              tApp('store.errors.popupBlocked', 'Popup was blocked. Please allow popups for this site.'),
            );
            set({ connectingAppKey: null });
            return false;
          }

          // Callback HTML posts connected-app-oauth-result from the backend origin; poll when user closes popup
          return new Promise<boolean>((resolve) => {
            let settled = false;
            let pollTimer: ReturnType<typeof setInterval>;
            let onMessageHandler: (event: MessageEvent) => void;

            const cleanup = () => {
              clearInterval(pollTimer);
              window.removeEventListener('message', onMessageHandler);
            };

            const refetchAndResolve = async (opts?: {
              oauthSuccess?: boolean;
              oauthError?: string;
            }) => {
              set({ connectingAppKey: null });
              try {
                const [apps, mailboxCapability] = await Promise.all([
                  api.getAvailableApps(),
                  api.getMailboxCapability().catch(() => null),
                ]);
                set({ apps, mailboxCapability, isInitialized: true });
                const connected = apps.some((a) => a.appKey === appKey && a.connected);
                if (opts?.oauthSuccess && connected) {
                  toast.success(tApp('store.connected', 'App connected successfully'));
                } else if (opts?.oauthSuccess && !connected) {
                  toast.error(
                    tApp(
                      'store.errors.connectIncomplete',
                      'Connection did not complete. Please try again.',
                    ),
                  );
                } else if (opts?.oauthError) {
                  toast.error(opts.oauthError);
                } else if (connected) {
                  toast.success(tApp('store.connected', 'App connected successfully'));
                }
                resolve(connected);
              } catch {
                resolve(false);
              }
            };

            onMessageHandler = (event: MessageEvent) => {
              if (!isTrustedOAuthMessageOrigin(event.origin)) return;
              const data = event.data as OAuthPopupResult | undefined;
              if (
                !data ||
                data.type !== 'connected-app-oauth-result' ||
                data.appKey !== appKey
              ) {
                return;
              }
              if (settled) return;
              settled = true;
              cleanup();
              void refetchAndResolve({
                oauthSuccess: data.success,
                oauthError: !data.success && data.error ? data.error : undefined,
              });
            };

            window.addEventListener('message', onMessageHandler);

            pollTimer = setInterval(() => {
              if (popup.closed && !settled) {
                settled = true;
                cleanup();
                void refetchAndResolve();
              }
            }, 500);
          });
        } catch {
          set({ connectingAppKey: null });
          toast.error(tApp('store.errors.connectFailed', 'Failed to start connection'));
          return false;
        }
      },

      disconnectApp: async (appKey: string) => {
        try {
          await api.disconnectApp(appKey);

          // Update local state
          set((state) => ({
            apps: state.apps.map((app) =>
              app.appKey === appKey
                ? { ...app, connected: false, connection: undefined }
                : app,
            ),
            mailboxCapability:
              state.mailboxCapability?.appKey === appKey
                ? {
                    ...state.mailboxCapability,
                    connected: false,
                    mailboxReady: false,
                    providerEmail: undefined,
                    grantedScopes: [],
                    missingScopes: ['mail.read'],
                  }
                : state.mailboxCapability,
          }));

          toast.success(tApp('store.disconnected', 'App disconnected'));
        } catch {
          toast.error(tApp('store.errors.disconnectFailed', 'Failed to disconnect'));
        }
      },

      isConnected: (appKey: string) => {
        return get().apps.some((app) => app.appKey === appKey && app.connected);
      },

      reset: () => set(initialState),
    }),
    { name: 'connected-app-store' },
  ),
);

// ===== Selectors =====

export const useConnectedApps = () =>
  useConnectedAppStore(useShallow((state) => state.apps));

export const useConnectedAppsLoading = () =>
  useConnectedAppStore((state) => state.isLoading);

export const useConnectingAppKey = () =>
  useConnectedAppStore((state) => state.connectingAppKey);

export const useMailboxCapability = () =>
  useConnectedAppStore((state) => state.mailboxCapability);

// ===== Imperative API (barrel export) =====

/**
 * Ensure user is connected to an app. Triggers OAuth popup if not.
 * Usable outside React components.
 */
export async function ensureAppConnected(appKey: string): Promise<boolean> {
  const store = useConnectedAppStore.getState();

  if (!store.isInitialized) {
    await store.fetchApps();
  }

  if (store.isConnected(appKey)) return true;
  return store.connectApp(appKey);
}
