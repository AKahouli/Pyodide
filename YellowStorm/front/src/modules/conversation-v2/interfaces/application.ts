import type { RawFilesTreeNode } from './events';

export type FilesTreeNode = RawFilesTreeNode;

export type NodepodPreviewStatus =
  | 'idle'
  | 'loading'
  | 'installing'
  | 'starting'
  | 'ready'
  | 'error';

export interface UseNodepodPreviewArgs {
  sessionId: string | null;
  cephPath?: string | null;
  filesTree?: RawFilesTreeNode | null;
  /** Bump to force a full reboot (e.g. new agent generation). */
  revision?: string;
}

export interface UseNodepodPreviewResult {
  status: NodepodPreviewStatus;
  previewUrl: string | null;
  error: string | null;
  /** Downloaded project files (VFS paths like `/src/App.tsx`). Read-only for UI. */
  files: Record<string, string | Uint8Array> | null;
  retry: () => void;
}
