export type ConversationV2EventType =
  | 'message' | 'tool' | 'step' | 'plan' | 'title' | 'done' | 'wait' | 'error';

export interface BaseEvent {
  event_id: string;
  timestamp: number;
}

export type AgentEvent =
  | ({ type: 'message' } & BaseEvent & { role: 'user' | 'assistant'; content: string; attachments?: FileInfo[] })
  | ({ type: 'tool' } & BaseEvent & { tool_call_id: string; name: string; status: string; function: string; args: Record<string, unknown>; content?: ToolContent })
  | ({ type: 'step' } & BaseEvent & { id: string; status: string; description: string })
  | ({ type: 'plan' } & BaseEvent & { steps: Array<{ id: string; status: string; description: string }> })
  | ({ type: 'title' } & BaseEvent & { title: string })
  | ({ type: 'done' } & BaseEvent)
  | ({ type: 'wait' } & BaseEvent)
  | ({ type: 'error' } & BaseEvent & { error: string });

export type ToolContent =
  | { kind: 'browser'; screenshot_url: string; url?: string; title?: string }
  | { kind: 'shell'; command: string; output: string; exit_code: number; session_handle?: string }
  | { kind: 'file'; path: string; content: string; language?: string; operation?: 'read' | 'write' | 'edit' | string }
  | { kind: 'search'; query: string; results: Array<{ title: string; url: string; snippet: string }> }
  | { kind: 'mcp'; server: string; tool: string; result: unknown }
  | { kind: 'generic'; data: unknown };

export interface FileInfo {
  id: string;
  name: string;
  content_type: string;
  url: string;
}

export interface SessionPayload {
  sessionId: string;
  title: string;
  status: string;
  isShared: boolean;
  events: AgentEvent[];
}

export type ConversationV2SessionStatus =
  | 'active' | 'waiting' | 'paused' | 'stopped' | 'completed' | 'error';

export interface ConversationV2PointerSummary {
  sessionId: string;
  title: string;
  status: ConversationV2SessionStatus;
  lastEventAt: string;
  isShared: boolean;
}

export interface ListSessionsResponse {
  items: ConversationV2PointerSummary[];
  nextCursor: string | null;
}
