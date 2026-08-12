export type ConversationV2EventType =
  | 'message' | 'tool' | 'step' | 'plan' | 'title' | 'done' | 'wait' | 'error'
  | 'application_component' | 'app_build_progress';

export interface BaseEvent {
  event_id: string;
  timestamp: number;
  /** Present on every persisted event; absent on optimistic client-side user echo. */
  sequence?: number;
}

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface PendingQuestion {
  questionId?: string;
  questionText?: string;
  options: QuestionOption[];
}

export interface RawFilesTreeNode {
  name: string;
  type: 'file' | 'directory';
  path?: string;
  size?: number;
  children?: RawFilesTreeNode[];
}

export type AgentEvent =
  | ({ type: 'message' } & BaseEvent & {
      role: 'user' | 'assistant';
      content: string;
      attachments?: FileInfo[];
      modelId?: string | null;
    })
  | ({ type: 'tool' } & BaseEvent & { tool_call_id: string; name: string; status: string; function: string; args: Record<string, unknown>; content?: ToolContent })
  | ({ type: 'step' } & BaseEvent & { id: string; status: string; description: string })
  | ({ type: 'plan' } & BaseEvent & { steps: Array<{ id: string; status: string; description: string }> })
  | ({ type: 'title' } & BaseEvent & { title: string })
  | ({ type: 'done' } & BaseEvent)
  | ({ type: 'wait' } & BaseEvent & {
      question_id?: string;
      question_text?: string;
      options?: QuestionOption[];
    })
  | ({ type: 'error' } & BaseEvent & { error: string })
  | ({ type: 'application_component' } & BaseEvent & {
      url: string;
      title?: string;
      ceph_path?: string;
      files_tree?: RawFilesTreeNode | null;
      file_count?: number;
    })
  | ({ type: 'app_build_progress' } & BaseEvent & {
      phase: string;
      message: string;
    });

export interface FileInfo {
  id: string;
  name: string;
  content_type: string;
  /** Ceph object key. Exchange via `conversationV2Api.getFileSignedUrl(path)` for a presigned read URL. */
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

export interface UserSearchResult {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface PipeEvent {
  type: AgentEvent['type'];
  data: Record<string, unknown>;
}

export interface PersistedEventEnvelope {
  sessionId: string;
  sequence: number;
  eventId: string;
  type: AgentEvent['type'];
  emittedAt: number;
  payload: Record<string, unknown>;
  modelId?: string | null;
}
