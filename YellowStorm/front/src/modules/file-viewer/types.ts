/**
 * File Viewer Module Types
 */

export interface FileTab {
  /** Unique tab ID */
  id: string;
  /** Workspace ID (only for workspace documents) */
  workspaceId?: string;
  /** Document ID (only for workspace documents) */
  documentId?: string;
  /**
   * Stored object key for workspace documents. Held on the tab so that URL
   * refreshes can re-sign the same object without going through the legacy
   * workspaceId+docId lookup endpoint.
   */
  path?: string;
  fileName: string;
  /** MIME type of the file (e.g. 'application/pdf') */
  mimeType: string;
  /** Presigned download URL */
  url: string;
  /** ISO timestamp when the URL expires (only for workspace documents) */
  urlExpiresAt?: string;
  /** Whether the file URL is currently being loaded */
  isLoading?: boolean;
}

export type HighlightBBox = [number, number, number, number];

export interface FileOpenOptions {
  /** Page number to scroll to after load */
  page?: number;
  /** Text to highlight/search after load */
  highlightText?: string;
  /** PDF page coordinates to use when text search cannot locate the exact quote */
  highlightBBox?: HighlightBBox;
  /** Whether to open as floating window or sidebar panel */
  displayMode?: DisplayMode;
  /** Whether clicking the floating backdrop closes the viewer */
  closeOnOutsideClick?: boolean;
  /** Spreadsheet-specific navigation (sheet + row highlighting) */
  spreadsheet?: SpreadsheetNavigationOptions;
}

export interface PendingNavigation {
  tabId: string;
  page?: number;
  highlightText?: string;
  highlightBBox?: HighlightBBox;
  spreadsheet?: SpreadsheetNavigationOptions;
}

export interface SpreadsheetNavigationOptions {
  /** Sheet name to activate (case-insensitive). Takes precedence over sheetIndex */
  sheetName?: string;
  /** 1-based sheet index if sheetName is not provided */
  sheetIndex?: number;
  /** Row number to scroll to */
  focusRow?: number;
  /** Row number to highlight (defaults to focusRow if unset) */
  highlightRow?: number;
}

export interface WindowPosition {
  x: number;
  y: number;
}

export interface WindowSize {
  width: number;
  height: number;
}

export type ViewerMode = 'open' | 'minimized' | 'closed';

export type DisplayMode = 'floating' | 'sidebar';

export interface RendererProps {
  tab: FileTab;
  isActive: boolean;
  onReady?: () => void;
}
