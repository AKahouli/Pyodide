/**
 * File Viewer Zustand Store
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { toast } from 'sonner';
import { getArtifactDownloadUrl } from '../conversation/api';
import { getErrorMessage } from '@/lib/error-codes';
import type { ApiError } from '@/lib/api/client';
import type { FileTab, FileOpenOptions, PendingNavigation, WindowPosition, WindowSize, ViewerMode, DisplayMode } from './types';
import { i18nInstance } from '@/modules/localization/i18nInstance';
import type { ModuleTranslationKey, TranslationParams } from '@/modules/localization';

// ===== Constants =====

const DEFAULT_WIDTH = 900;
const DEFAULT_HEIGHT = 650;
const MIN_WIDTH = 480;
const MIN_HEIGHT = 360;
const URL_EXPIRY_SAFETY_MARGIN_MS = 60_000;
const SIDEBAR_MIN_VIEWPORT_WIDTH = 768;
/**
 * Path-signer endpoint (POST /conversations/artifact-url) issues URLs that
 * expire after 60 minutes. Kept as a client-side constant because the
 * endpoint only returns the URL, not its expiry — we still want to refetch
 * before the URL goes stale rather than letting the renderer 403.
 */
const SIGNED_URL_LIFETIME_MS = 60 * 60 * 1000;

type FileViewerTranslationKey = ModuleTranslationKey<'file-viewer'>;

function translateFileViewer(key: FileViewerTranslationKey, params?: TranslationParams) {
  return i18nInstance.t(key, { ns: 'file-viewer', ...params });
}

/** Sidebar is not usable on narrow viewports — fall back to floating. */
function resolveDisplayMode(requested: DisplayMode | undefined): DisplayMode | undefined {
  if (requested === 'sidebar' && window.innerWidth < SIDEBAR_MIN_VIEWPORT_WIDTH) {
    return 'floating';
  }
  return requested;
}

function getDefaultPosition(): WindowPosition {
  return {
    x: Math.max(0, Math.round((window.innerWidth - DEFAULT_WIDTH) / 2)),
    y: Math.max(0, Math.round((window.innerHeight - DEFAULT_HEIGHT) / 2)),
  };
}

function getDefaultMinimizedPosition(): WindowPosition {
  return {
    x: window.innerWidth - 280,
    y: window.innerHeight - 60,
  };
}

function createPendingNavigation(tabId: string, options?: FileOpenOptions): PendingNavigation | null {
  if (!options) return null;
  if (options.page === undefined && !options.highlightText && !options.highlightBBox && !options.spreadsheet) {
    return null;
  }
  return {
    tabId,
    page: options.page,
    highlightText: options.highlightText,
    highlightBBox: options.highlightBBox,
    spreadsheet: options.spreadsheet,
  };
}

// ===== State Types =====

interface FileViewerState {
  mode: ViewerMode;
  displayMode: DisplayMode;
  tabs: FileTab[];
  activeTabId: string | null;
  position: WindowPosition;
  size: WindowSize;
  minimizedPosition: WindowPosition;
  pendingNavigation: PendingNavigation | null;
  closeOnOutsideClick: boolean;
}

interface FileViewerActions {
  /**
   * Open a workspace document by its stored object key (`document.path`).
   * The viewer signs the path directly via the path-signer endpoint — it no
   * longer reaches into `/workspaces/:id/documents/:docId/download-url`, so
   * stale (workspaceId, docId) → path resolution can't desync from current
   * storage layout. `workspaceId` and `docId` are still threaded through so
   * tabs dedupe per (workspace, doc) and the viewer can show legacy metadata.
   */
  openFile: (
    workspaceId: string,
    docId: string,
    path: string,
    fileName: string,
    mimeType: string,
    options?: FileOpenOptions,
  ) => Promise<void>;
  openFileFromUrl: (url: string, fileName: string, mimeType: string, options?: Pick<FileOpenOptions, 'displayMode' | 'closeOnOutsideClick' | 'page' | 'highlightText' | 'highlightBBox' | 'spreadsheet'>) => void;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  minimize: () => void;
  restore: () => void;
  closeViewer: () => void;
  setDisplayMode: (mode: DisplayMode) => void;
  switchToFloating: () => void;
  switchToSidebar: () => void;
  setPosition: (pos: WindowPosition) => void;
  setSize: (size: WindowSize) => void;
  setMinimizedPosition: (pos: WindowPosition) => void;
  refreshTabUrl: (tabId: string) => Promise<void>;
}

type FileViewerStore = FileViewerState & FileViewerActions;

// ===== Store =====

export const useFileViewerStore = create<FileViewerStore>()(
  devtools(
    (set, get) => ({
      // State
      mode: 'closed',
      displayMode: 'floating',
      tabs: [],
      activeTabId: null,
      position: getDefaultPosition(),
      size: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
      minimizedPosition: getDefaultMinimizedPosition(),
      pendingNavigation: null,
      closeOnOutsideClick: false,

      // Actions
      openFile: async (workspaceId, docId, path, fileName, mimeType, options) => {
        const tabId = `${workspaceId}:${docId}`;
        const { tabs, mode } = get();

        // Path is now the authoritative input — without it the path-signer
        // can't produce a URL. Surface this loudly instead of opening an
        // empty tab the renderer will choke on.
        if (!path) {
          toast.error(translateFileViewer('store.openError.title'), {
            description: translateFileViewer('store.openError.description'),
          });
          return;
        }

        const signAndCompute = async () => {
          const { downloadUrl } = await getArtifactDownloadUrl(path, fileName);
          return {
            url: downloadUrl,
            expiresAt: new Date(Date.now() + SIGNED_URL_LIFETIME_MS).toISOString(),
          };
        };

        // Check if tab already exists
        const existingTab = tabs.find((t) => t.id === tabId);
        if (existingTab) {
          // Check if URL is expired and needs refresh
          const isExpired = existingTab.urlExpiresAt ? Date.now() >= new Date(existingTab.urlExpiresAt).getTime() - URL_EXPIRY_SAFETY_MARGIN_MS : false;

          if (isExpired) {
            // Mark as loading and refresh in background
            set((state) => ({
              tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, isLoading: true } : t)),
              activeTabId: tabId,
              mode: 'open',
              pendingNavigation: createPendingNavigation(tabId, options),
              closeOnOutsideClick: options?.closeOnOutsideClick ?? false,
            }));

            try {
              const response = await signAndCompute();
              set((state) => ({
                tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, url: response.url, urlExpiresAt: response.expiresAt, isLoading: false } : t)),
              }));
            } catch {
              // Use existing URL if refresh fails, just remove loading state
              set((state) => ({
                tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, isLoading: false } : t)),
              }));
            }
          } else {
            // Tab exists and URL is fresh, just activate it
            const resolved = resolveDisplayMode(options?.displayMode);
            set({
              activeTabId: tabId,
              mode: 'open',
              pendingNavigation: createPendingNavigation(tabId, options),
              closeOnOutsideClick: options?.closeOnOutsideClick ?? false,
              ...(resolved ? { displayMode: resolved } : {}),
            });
          }
          return;
        }

        // Create tab immediately with loading state, open modal right away
        const loadingTab: FileTab = {
          id: tabId,
          workspaceId,
          documentId: docId,
          path,
          fileName,
          mimeType,
          url: '', // Will be filled when loaded
          isLoading: true,
        };

        const resolvedMode = resolveDisplayMode(options?.displayMode);
        set((state) => ({
          tabs: [...state.tabs, loadingTab],
          activeTabId: tabId,
          mode: 'open',
          pendingNavigation: createPendingNavigation(tabId, options),
          closeOnOutsideClick: options?.closeOnOutsideClick ?? false,
          // Set displayMode if provided, default to 'floating' when opening fresh
          ...(resolvedMode
            ? { displayMode: resolvedMode }
            : mode === 'closed'
              ? { displayMode: 'floating' as const }
              : {}),
          // Reset position to default if viewer was closed
          ...(mode === 'closed'
            ? {
                position: getDefaultPosition(),
                size: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
              }
            : {}),
        }));

        // Fetch presigned URL in background
        try {
          const response = await signAndCompute();
          set((state) => ({
            tabs: state.tabs.map((t) =>
              t.id === tabId
                ? { ...t, url: response.url, urlExpiresAt: response.expiresAt, isLoading: false }
                : t
            ),
          }));
        } catch (error) {
          const apiError = error as ApiError;
          const message = apiError?.code ? getErrorMessage(apiError.code) : translateFileViewer('store.openError.description');
          toast.error(translateFileViewer('store.openError.title'), { description: message });
          // Remove the failed tab
          set((state) => ({
            tabs: state.tabs.filter((t) => t.id !== tabId),
            activeTabId: state.tabs.length === 1 ? null : state.activeTabId,
          }));
        }
      },

      openFileFromUrl: (url, fileName, mimeType, options) => {
        const tabId = `url:${url}`;
        const { tabs } = get();
        const resolved = resolveDisplayMode(options?.displayMode);
        const pending = createPendingNavigation(tabId, options as FileOpenOptions | undefined);

        // If tab already exists, just activate it
        const existingTab = tabs.find((t) => t.id === tabId);
        if (existingTab) {
          set({
            activeTabId: tabId,
            mode: 'open',
            pendingNavigation: pending,
            closeOnOutsideClick: options?.closeOnOutsideClick ?? false,
            ...(resolved ? { displayMode: resolved } : {}),
          });
          return;
        }

        const newTab: FileTab = {
          id: tabId,
          fileName,
          mimeType,
          url,
        };

        set((state) => ({
          tabs: [...state.tabs, newTab],
          activeTabId: tabId,
          mode: 'open',
          pendingNavigation: pending,
          closeOnOutsideClick: options?.closeOnOutsideClick ?? false,
          // Set displayMode if provided, default to 'floating' when opening fresh
          ...(resolved
            ? { displayMode: resolved }
            : state.mode === 'closed'
              ? { displayMode: 'floating' as const }
              : {}),
          ...(state.mode === 'closed'
            ? {
                position: getDefaultPosition(),
                size: { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT },
              }
            : {}),
        }));
      },

      closeTab: (tabId) => {
        const { tabs, activeTabId } = get();
        const remaining = tabs.filter((t) => t.id !== tabId);

        if (remaining.length === 0) {
          set({
            tabs: [],
            activeTabId: null,
            mode: 'closed',
            pendingNavigation: null,
          });
          return;
        }

        // If closing the active tab, switch to the last remaining tab
        const newActiveId = activeTabId === tabId ? remaining[remaining.length - 1].id : activeTabId;

        set({
          tabs: remaining,
          activeTabId: newActiveId,
          pendingNavigation: null,
        });
      },

      setActiveTab: (tabId) => {
        set({ activeTabId: tabId, pendingNavigation: null });
      },

      minimize: () => {
        if (get().displayMode !== 'floating') return;
        set({ mode: 'minimized' });
      },

      restore: () => {
        set({ mode: 'open' });
      },

      closeViewer: () => {
        set({
          mode: 'closed',
          displayMode: 'floating',
          tabs: [],
          activeTabId: null,
          pendingNavigation: null,
          closeOnOutsideClick: false,
        });
      },

      setDisplayMode: (mode) => {
        set({ displayMode: mode });
      },

      switchToFloating: () => {
        set({ displayMode: 'floating', mode: 'open' });
      },

      switchToSidebar: () => {
        const resolved = resolveDisplayMode('sidebar') ?? 'sidebar';
        set({ displayMode: resolved, mode: 'open' });
      },

      setPosition: (pos) => {
        set({ position: pos });
      },

      setSize: (size) => {
        set({
          size: {
            width: Math.max(MIN_WIDTH, size.width),
            height: Math.max(MIN_HEIGHT, size.height),
          },
        });
      },

      setMinimizedPosition: (pos) => {
        set({ minimizedPosition: pos });
      },

      refreshTabUrl: async (tabId) => {
        const tab = get().tabs.find((t) => t.id === tabId);
        if (!tab || !tab.path) return;

        try {
          const { downloadUrl } = await getArtifactDownloadUrl(tab.path, tab.fileName);
          const expiresAt = new Date(Date.now() + SIGNED_URL_LIFETIME_MS).toISOString();
          set((state) => ({
            tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, url: downloadUrl, urlExpiresAt: expiresAt } : t)),
          }));
        } catch (error) {
          const apiError = error as ApiError;
          const message = apiError?.code ? getErrorMessage(apiError.code) : translateFileViewer('store.refreshError.description');
          toast.error(translateFileViewer('store.refreshError.title'), { description: message });
        }
      },
    }),
    { name: 'file-viewer-store' },
  ),
);

// ===== Selector Hooks =====

import { useShallow } from 'zustand/react/shallow';

export const useFileViewerMode = () => useFileViewerStore((s) => s.mode);
export const useFileViewerDisplayMode = () => useFileViewerStore((s) => s.displayMode);
export const useFileViewerTabs = () => useFileViewerStore(useShallow((s) => s.tabs));
export const useFileViewerActiveTabId = () => useFileViewerStore((s) => s.activeTabId);
export const useFileViewerPosition = () => useFileViewerStore(useShallow((s) => s.position));
export const useFileViewerSize = () => useFileViewerStore(useShallow((s) => s.size));
export const useFileViewerMinimizedPosition = () => useFileViewerStore(useShallow((s) => s.minimizedPosition));
export const useFileViewerPendingNavigation = () => useFileViewerStore((s) => s.pendingNavigation);
