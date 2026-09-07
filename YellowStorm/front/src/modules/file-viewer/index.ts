/**
 * File Viewer Module
 * Floating file viewer with tabbed document support
 */

import { useFileViewerStore } from './store';
import type { FileOpenOptions } from './types';

export { FileFloatingWindow, FileViewerSidebar } from './components';
export { useFileViewerStore, useFileViewerMode, useFileViewerDisplayMode } from './store';
export { isViewableFile, isViewableFilename, getMimeTypeFromFilename, PptxRenderer } from './renderers';
export type {
  FileTab,
  FileOpenOptions,
  ViewerMode,
  DisplayMode,
  HighlightBBox,
  SpreadsheetNavigationOptions,
} from './types';

/**
 * Open a workspace document in the file viewer. `path` is the document's
 * stored object key (`WorkspaceDocument.path`); the viewer signs it directly
 * via the path-signer endpoint. workspaceId + docId are still required for
 * tab identity (so re-opening the same doc reuses its tab).
 */
export function openFileViewer(
  workspaceId: string,
  docId: string,
  path: string,
  fileName: string,
  mimeType: string,
  options?: FileOpenOptions,
) {
  return useFileViewerStore.getState().openFile(workspaceId, docId, path, fileName, mimeType, options);
}

/**
 * Open a file from a non-renewable direct URL in the file viewer.
 * Signed URLs should use openFileViewerFromUrlLoader so they can be refreshed.
 */
export function openFileViewerFromUrl(
  url: string,
  fileName: string,
  mimeType: string,
  options?: FileOpenOptions,
) {
  return useFileViewerStore.getState().openFileFromUrl(url, fileName, mimeType, options);
}

/** Open the viewer immediately while an asynchronous URL resolver runs. */
export function openFileViewerFromUrlLoader(
  key: string,
  fileName: string,
  mimeType: string,
  load: () => Promise<{ url: string; fileName?: string; mimeType?: string }>,
  options?: FileOpenOptions,
) {
  return useFileViewerStore.getState().openFileFromUrlLoader(key, fileName, mimeType, load, options);
}
