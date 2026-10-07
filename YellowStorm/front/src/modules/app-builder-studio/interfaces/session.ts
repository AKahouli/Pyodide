import type { AgentEvent } from './events';
import type { AppBuilderStudioSessionPermission, AppBuilderStudioViewerRole } from './permissions';

export interface SessionPayload {
  sessionId: string;
  title: string;
  status: string;
  isShared: boolean;
  events: AgentEvent[];
  workspaceIds?: string[];
}

export type AppBuilderStudioSessionStatus =
  | 'active' | 'waiting' | 'paused' | 'stopped' | 'completed' | 'error';

export interface AppBuilderStudioPointerSummary {
  sessionId: string;
  title: string;
  status: AppBuilderStudioSessionStatus;
  lastEventAt: string;
  isShared: boolean;
  workspaceIds: string[];
}

export interface ListSessionsResponse {
  items: AppBuilderStudioPointerSummary[];
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
  /** Template `template_<id>` or system starter — used to restore clone preview after reload. */
  starterRevisionId?: string | null;
  deployStatus: 'idle' | 'deploying' | 'deployed' | 'error';
  deployedUrl: string | null;
  lastDeployedAt: string | null;
  viewerRole?: AppBuilderStudioViewerRole;
  permissions?: AppBuilderStudioSessionPermission[];
}

/** Entry point that created this session — drives transition UX on the session page. */
export type AgentSessionSource = 'new-conversation' | 'app-builder' | 'template-clone';

/**
 * React Router `location.state` carried into Conversation V2 session routes
 * (new conversation, App Builder start, template Clone App).
 */
export interface AgentSessionLocationState {
  initialMessage?: string;
  /**
   * LiteLLM model identifier (e.g. "azure/gpt-4.1") resolved on the
   * new-conversation page. Avoids waiting for the models cache to load before
   * we can fire off the first message.
   */
  model?: string;
  /** Skill selection carried from the new-conversation page for the initial send. */
  skillIds?: string[];
  /** Connector selection carried from the new-conversation page for the initial send. */
  connectorIds?: string[];
  /** Entry point that created this session — drives transition UX. */
  source?: AgentSessionSource;
  /** App Market template id when cloning or starting from a template. */
  templateId?: string;
  /** OpenCode capability for this session (`web_app` or `database_design`). */
  capability?: 'web_app' | 'database_design';
}

/** Alias kept for existing imports; prefer {@link AgentSessionLocationState}. */
export type LocationState = AgentSessionLocationState;
