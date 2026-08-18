/**
 * Browser runtime protocol types — mirrors the backend app-runtime module.
 * Keep in sync with YellowStorm/back/src/modules/app-runtime/types/app-runtime-protocol.ts
 */

export interface RuntimeCapabilities {
  filesystem: boolean;
  npm: boolean;
  previewInspection: boolean;
  nativeBinaries: boolean;
}

export interface RuntimeTicketResponse {
  runtimeSessionId: string;
  ticket: string;
  workspaceId: string;
  revisionId: string;
  expiresAt: string;
}

export interface ToolInvokePayload {
  toolCallId: string;
  workspaceId: string;
  tool: string;
  arguments: Record<string, unknown>;
  baseRevisionId: string;
  timeoutMs: number;
}

export interface ToolProgressPayload {
  toolCallId: string;
  phase?: string;
  message?: string;
}

export interface ToolCompletedPayload {
  toolCallId: string;
  result: Record<string, unknown>;
}

export interface ToolFailedPayload {
  toolCallId: string;
  error: RuntimeToolError;
}

export interface RuntimeToolError {
  code: number;
  message: string;
  data?: Record<string, unknown>;
}

export interface RuntimeRehydratePayload {
  workspaceId: string;
  expectedRevisionId: string;
  actualRevisionId: string;
}

export interface RuntimeRegisterPayload {
  runtimeSessionId: string;
  workspaceId: string;
  revisionId: string;
  capabilities: Partial<RuntimeCapabilities>;
  browserRuntimeId?: string;
}

export interface RuntimeHeartbeatPayload {
  workspaceId: string;
  revisionId?: string;
}

export type RuntimeHostStatus =
  | 'idle'
  | 'connecting'
  | 'registering'
  | 'hydrating'
  | 'installing'
  | 'starting'
  | 'ready'
  | 'error'
  | 'disconnected';

/**
 * Minimal UI-facing runtime status in the Zustand store.
 * No infra IDs (ticket, mcpToken, lease, sandbox) — only what the panel needs.
 */
export type AppRuntimeUiStatus =
  | 'idle'
  | 'connecting'
  | 'hydrating'
  | 'browser_active'
  | 'offline'
  | 'error';

/** Map host lifecycle → store vocabulary (Vague 5). */
export function mapHostStatusToRuntimeUi(
  status: RuntimeHostStatus,
): AppRuntimeUiStatus {
  switch (status) {
    case 'connecting':
    case 'registering':
      return 'connecting';
    case 'hydrating':
    case 'installing':
    case 'starting':
      return 'hydrating';
    case 'ready':
      return 'browser_active';
    case 'disconnected':
      return 'offline';
    case 'error':
      return 'error';
    case 'idle':
    default:
      return 'idle';
  }
}

/** True when the right panel may show the Nodepod preview without application_component. */
export function isRuntimePreviewVisible(status: AppRuntimeUiStatus): boolean {
  return (
    status === 'connecting' ||
    status === 'hydrating' ||
    status === 'browser_active' ||
    status === 'offline' ||
    status === 'error'
  );
}

export const BrowserRuntimeEvents = {
  REGISTER: 'runtime.register',
  HEARTBEAT: 'runtime.heartbeat',
  REHYDRATE: 'runtime.rehydrate',
  TOOL_INVOKE: 'tool.invoke',
  TOOL_PROGRESS: 'tool.progress',
  TOOL_COMPLETED: 'tool.completed',
  TOOL_FAILED: 'tool.failed',
} as const;

export const RuntimeErrorCodes = {
  UNSUPPORTED_CAPABILITY: -32001,
  RUNTIME_OFFLINE: -32002,
  REVISION_CONFLICT: -32003,
  CHECKPOINT_FAILED: -32004,
  TOOL_TIMEOUT: -32005,
  TOOL_CANCELLED: -32006,
  PROCESS_FAILED: -32007,
  SECURITY_DENIED: -32008,
  QUOTA_EXCEEDED: -32009,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
} as const;

/* -------------------------------------------------------------------------
 * Tool result shapes — keep the keys byte-identical to
 * APImanus backend/app/infrastructure/opencode/runtime_mcp/schemas.py
 * ---------------------------------------------------------------------- */

export interface FileEntry {
  name: string;
  type: 'file' | 'dir';
  size: number;
  sha256: string | null;
}

export interface SearchMatch {
  path: string;
  line: number;
  excerpt: string;
  sha256: string;
}

export interface ListResult {
  path: string;
  entries: FileEntry[];
}

export interface ReadResult {
  path: string;
  content: string;
  sha256: string;
  lineCount: number;
  truncated: boolean;
}

export interface SearchResult {
  query: string;
  matches: SearchMatch[];
}

export interface WriteResult {
  revisionId: string;
  path: string;
  previousSha256: string | null;
  newSha256: string;
  created: boolean;
}

export interface ApplyPatchResult {
  revisionId: string;
  path: string;
  previousSha256: string | null;
  newSha256: string;
  diff: string;
}

export interface DeleteResult {
  revisionId: string;
  path: string;
  deletedSha256: string | null;
}

export interface DiffResult {
  revisionId: string;
  parentRevisionId: string | null;
  diff: string;
  changedFiles: string[];
}

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  truncated: boolean;
  command: string;
}

export interface DevServerResult {
  running: boolean;
  url: string | null;
  port: number | null;
  message: string;
}

/** One flattened DOM node in `preview_inspect.domSummary`. */
export interface DomSummaryNode extends Record<string, unknown> {
  tag: string;
  depth: number;
  id?: string;
  class?: string;
  role?: string;
  text?: string;
}

export interface PreviewInspectResult {
  url: string;
  title: string;
  visibleText: string;
  domSummary: DomSummaryNode[];
  console: string[];
  runtimeErrors: string[];
  screenshotArtifactId: string | null;
  capabilities: {
    screenshot: boolean;
    interaction: boolean;
  };
}

export type PreviewActionName =
  | 'reload'
  | 'click'
  | 'input'
  | 'press_key'
  | 'select'
  | 'scroll';

export interface PreviewActionResult {
  ok: boolean;
  action: PreviewActionName;
}

export interface VerificationEvidence {
  build: string;
  preview: string;
  tests: string;
}

export interface FinalizeResult {
  revisionId: string;
  cephManifestPath: string;
  fileTree: FileTreeNode;
  preview: {
    runtime: string;
    healthy: boolean;
  };
  verification: VerificationEvidence;
}

export interface FileTreeNode extends Record<string, unknown> {
  name: string;
  type: 'file' | 'directory';
  path?: string;
  children?: FileTreeNode[];
}

/** Emitted mid-tool so the backend can re-arm its per-call deadline. */
export type ToolProgressReporter = (
  progress: Omit<ToolProgressPayload, 'toolCallId'>,
) => void;
