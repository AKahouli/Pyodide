export type ConversationV2EventType =
  | 'message'
  | 'tool'
  | 'step'
  | 'plan'
  | 'title'
  | 'done'
  | 'wait'
  | 'error';

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

export type DoneEventPayload = ConversationV2BaseEvent;
export type WaitEventPayload = ConversationV2BaseEvent;

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
    | WaitEventPayload;
}

export interface SessionWithEvents {
  sessionId: string;
  title: string;
  status: string;
  isShared: boolean;
  events: ConversationV2Event[];
  workspaceIds?: string[];
}
