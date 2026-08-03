export type ConversationV2EventType =
  | 'message' | 'tool' | 'step' | 'plan' | 'title' | 'done' | 'wait' | 'error' | 'application_component';

export interface BaseEvent {
  event_id: string;
  timestamp: number;
  sequence?: number;          // present on every persisted event; absent on optimistic client-side user echo
}

/** Nested source tree from Manus `/app/code` (files_tree_json). */
export interface FilesTreeNode {
  name: string;
  type: 'file' | 'directory';
  path?: string;
  size?: number;
  children?: FilesTreeNode[];
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
  | ({ type: 'wait' } & BaseEvent)
  | ({ type: 'error' } & BaseEvent & { error: string })
  | ({ type: 'application_component' } & BaseEvent & {
      url: string;
      title?: string;
      ceph_path?: string;
      files_tree?: FilesTreeNode | null;
      file_count?: number;
    });

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

export interface FileInfo {
  id: string;
  name: string;
  content_type: string;
  /**
   * Ceph object key — `{ownerUserId}/{storagePrefix}/{filename}`. Not directly
   * fetchable; exchange via `conversationV2Api.getFileSignedUrl(path)` for a
   * short-lived presigned read URL before opening the file viewer.
   */
  path: string;
}

export interface SessionPayload {
  sessionId: string;
  title: string;
  status: string;
  isShared: boolean;
  events: AgentEvent[];
  workspaceIds?: string[];
}

export type ConversationV2SessionStatus =
  | 'active' | 'waiting' | 'paused' | 'stopped' | 'completed' | 'error';

export interface ConversationV2PointerSummary {
  sessionId: string;
  title: string;
  status: ConversationV2SessionStatus;
  lastEventAt: string;
  isShared: boolean;
  workspaceIds: string[];
}

export interface ListSessionsResponse {
  items: ConversationV2PointerSummary[];
  nextCursor: string | null;
}
