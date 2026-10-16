export type AppBuilderEventType =
  | 'message'
  | 'tool'
  | 'step'
  | 'plan'
  | 'title'
  | 'done'
  | 'wait'
  | 'error'
  | 'application_component'
  | 'app_build_progress'
  | 'heartbeat';

export interface AppBuilderBaseEvent {
  event_id: string;
  timestamp: number; // unix seconds
}

export interface MessageEventPayload extends AppBuilderBaseEvent {
  role: 'user' | 'assistant';
  content: string;
  attachments?: FileInfo[];
}

export interface ToolEventPayload extends AppBuilderBaseEvent {
  tool_call_id: string;
  name: string;
  status: string;
  function: string;
  args: Record<string, unknown>;
  content?: ToolContent;
}

export interface StepEventPayload extends AppBuilderBaseEvent {
  id: string;
  status: string;
  description: string;
}

export interface PlanEventPayload extends AppBuilderBaseEvent {
  steps: { id: string; status: string; description: string }[];
}

export interface TitleEventPayload extends AppBuilderBaseEvent {
  title: string;
}

export interface ErrorEventPayload extends AppBuilderBaseEvent {
  error: string;
}

// Agent-pushed embeddable web app. Frontend boots Nodepod from Ceph sources
// when `ceph_path` + `files_tree` are present.
export interface ApplicationComponentEventPayload extends AppBuilderBaseEvent {
  url: string;
  title?: string;
  ceph_path?: string;
  files_tree?: FilesTreeNode | null;
  file_count?: number;
  revision_id?: string;
}

/** Agent workflow progress while generating / validating an app before preview. */
export interface AppBuildProgressEventPayload extends AppBuilderBaseEvent {
  phase: string;
  message: string;
}

/** Nested source tree produced by Manus `/app/code` → files_tree_json. */
export interface FilesTreeNode {
  name: string;
  type: 'file' | 'directory';
  path?: string;
  size?: number;
  children?: FilesTreeNode[];
}

export type DoneEventPayload = AppBuilderBaseEvent;

export interface QuestionOptionPayload {
  label: string;
  description?: string;
}

export interface WaitEventPayload extends AppBuilderBaseEvent {
  question_id?: string;
  question_text?: string;
  options?: QuestionOptionPayload[];
}
// No-op liveness signal while a step is still in flight — never persisted or
// pushed to the frontend; only resets the gRPC stream's idle timer.
export type HeartbeatEventPayload = AppBuilderBaseEvent;

export interface FileInfo {
  id: string;
  name: string;
  content_type: string;
  // Ceph object key (`{ownerUserId}/{storagePrefix}/{filename}`). Frontend exchanges
  // this for a short-lived presigned read URL via POST /app-builder/files/signed-url
  // when the user clicks the attachment.
  path: string;
}

export type ToolContent =
  | { kind: 'browser'; screenshot_url: string; url?: string; title?: string }
  | { kind: 'shell'; command: string; output: string; exit_code: number; session_handle?: string }
  | { kind: 'file'; path: string; content: string; language?: string; operation?: 'read' | 'write' | 'edit' | string }
  | { kind: 'search'; query: string; results: { title: string; url: string; snippet: string }[] }
  | { kind: 'mcp'; server: string; tool: string; result: unknown }
  | { kind: 'webpage'; url: string; title?: string }
  | { kind: 'generic'; data: unknown };

export interface AppBuilderEvent {
  type: AppBuilderEventType;
  payload:
    | MessageEventPayload
    | ToolEventPayload
    | StepEventPayload
    | PlanEventPayload
    | TitleEventPayload
    | ErrorEventPayload
    | DoneEventPayload
    | WaitEventPayload
    | ApplicationComponentEventPayload
    | AppBuildProgressEventPayload
     ;
}

export interface SessionWithEvents {
  sessionId: string;
  title: string;
  status: string;
  isShared: boolean;
  events: AppBuilderEvent[];
  workspaceIds?: string[];
}
