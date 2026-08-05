export type ConversationV2EventType =
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

export interface ConversationV2BaseEvent {
  event_id: string;
  timestamp: number; // unix seconds
}

export interface MessageEventPayload extends ConversationV2BaseEvent {
  role: 'user' | 'assistant';
  content: string;
  attachments?: FileInfo[];
}

export interface ToolEventPayload extends ConversationV2BaseEvent {
  tool_call_id: string;
  name: string;
  status: string;
  function: string;
  args: Record<string, unknown>;
  content?: ToolContent;
}

export interface StepEventPayload extends ConversationV2BaseEvent {
  id: string;
  status: string;
  description: string;
}

export interface PlanEventPayload extends ConversationV2BaseEvent {
  steps: Array<{ id: string; status: string; description: string }>;
}

export interface TitleEventPayload extends ConversationV2BaseEvent {
  title: string;
}

export interface ErrorEventPayload extends ConversationV2BaseEvent {
  error: string;
}

// Agent-pushed embeddable web app. Frontend boots Nodepod from Ceph sources
// when `ceph_path` + `files_tree` are present.
export interface ApplicationComponentEventPayload extends ConversationV2BaseEvent {
  url: string;
  title?: string;
  ceph_path?: string;
  files_tree?: FilesTreeNode | null;
  file_count?: number;
}

/** Agent workflow progress while generating / validating an app before preview. */
export interface AppBuildProgressEventPayload extends ConversationV2BaseEvent {
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

export type DoneEventPayload = ConversationV2BaseEvent;
export type WaitEventPayload = ConversationV2BaseEvent;
// No-op liveness signal while a step is still in flight — never persisted or
// pushed to the frontend; only resets the gRPC stream's idle timer.
export type HeartbeatEventPayload = ConversationV2BaseEvent;

export interface FileInfo {
  id: string;
  name: string;
  content_type: string;
  // Ceph object key (`{ownerUserId}/{storagePrefix}/{filename}`). Frontend exchanges
  // this for a short-lived presigned read URL via POST /conversation-v2/files/signed-url
  // when the user clicks the attachment.
  path: string;
}

export type ToolContent =
  | { kind: 'browser'; screenshot_url: string; url?: string; title?: string }
  | { kind: 'shell'; command: string; output: string; exit_code: number; session_handle?: string }
  | { kind: 'file'; path: string; content: string; language?: string; operation?: 'read' | 'write' | 'edit' | string }
  | { kind: 'search'; query: string; results: Array<{ title: string; url: string; snippet: string }> }
  | { kind: 'mcp'; server: string; tool: string; result: unknown }
  | { kind: 'webpage'; url: string; title?: string }
  | { kind: 'generic'; data: unknown };

export interface ConversationV2Event {
  type: ConversationV2EventType;
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
    | HeartbeatEventPayload;
}

export interface SessionWithEvents {
  sessionId: string;
  title: string;
  status: string;
  isShared: boolean;
  events: ConversationV2Event[];
  workspaceIds?: string[];
}
