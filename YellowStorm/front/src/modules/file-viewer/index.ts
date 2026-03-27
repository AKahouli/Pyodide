/**
 * File Viewer Module
 * Floating file viewer with tabbed document support
 */

import { useFileViewerStore } from './store';
import type { DisplayMode } from './types';

export { FileFloatingWindow, FileViewerSidebar } from './components';
export { useFileViewerStore, useFileViewerMode, useFileViewerDisplayMode } from './store';
export { isViewableFile, isViewableFilename, getMimeTypeFromFilename, PptxRenderer } from './renderers';
export type { FileTab, FileOpenOptions, ViewerMode, DisplayMode } from './types';

/**
 * Open a workspace document in the file viewer.
 * Can be called from anywhere — no hooks needed.
 */
export function openFileViewer(workspaceId: string, docId: string, fileName: string, mimeType: string, options?: { page?: number; highlightText?: string; displayMode?: DisplayMode }) {
  return useFileViewerStore.getState().openFile(workspaceId, docId, fileName, mimeType, options);
}

/**
 * Open a file from a direct URL in the file viewer.
 * Used for artifacts and other non-workspace files.
 */
export function openFileViewerFromUrl(url: string, fileName: string, mimeType: string, options?: { displayMode?: DisplayMode }) {
  return useFileViewerStore.getState().openFileFromUrl(url, fileName, mimeType, options);
}
