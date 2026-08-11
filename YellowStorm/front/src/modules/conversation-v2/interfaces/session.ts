import type { AgentEvent } from './events';
import type { ConversationV2SessionPermission, ConversationV2ViewerRole } from './permissions';

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

export interface SessionPointer {
  sessionId: string;
  title: string;
  status: string;
  isShared: boolean;
  workspaceIds: string[];
  selectedSkillIds: string[];
  selectedConnectorIds: string[];
  lastEventAt: string;
  eventCount: number;
  systemWorkspaceId: string | null;
  deployStatus: 'idle' | 'deploying' | 'deployed' | 'error';
  deployedUrl: string | null;
  lastDeployedAt: string | null;
  viewerRole?: ConversationV2ViewerRole;
  permissions?: ConversationV2SessionPermission[];
}

export interface LocationState {
  initialMessage?: string;
  /** LiteLLM model identifier resolved on the new-conversation page. */
  model?: string;
  skillIds?: string[];
  connectorIds?: string[];
}
