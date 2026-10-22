import type { RawFilesTreeNode } from './events';

export type FilesTreeNode = RawFilesTreeNode;

export type NodepodPreviewStatus =
  | 'idle'
  | 'loading'
  | 'installing'
  | 'starting'
  | 'ready'
  | 'error';

/** Manus app-build workflow phases streamed before application_component. */
export type AppBuildPhase =
  | 'generation_started'
  | 'creating_files'
  | 'coding_complete'
  | 'installing_dependencies'
  | 'building_project'
  | 'waiting_for_build'
  | 'validating_preview'
  | 'fetching_app_code'
  | 'fetching_app_preview'
  | 'ready'
  | 'failed';

export interface AppBuildProgress {
  phase: AppBuildPhase | string;
  message: string;
  revision: string;
}

export interface UseNodepodPreviewArgs {
  sessionId: string | null;
}

export interface UseNodepodPreviewResult {
  status: NodepodPreviewStatus;
  previewUrl: string | null;
  error: string | null;
  /** Downloaded project files (VFS paths like `/src/App.tsx`). Read-only for UI. */
  files: Record<string, string | Uint8Array> | null;
  retry: () => void;
  previewIframeRef: (element: HTMLIFrameElement | null) => void;
}
