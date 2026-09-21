/** Store ports for channels.widget_* (plan 4.12–4.14). */
export const WIDGET_TOKEN_STORE = Symbol('WIDGET_TOKEN_STORE');
export const WIDGET_SESSION_STORE = Symbol('WIDGET_SESSION_STORE');
export const WIDGET_MESSAGE_STORE = Symbol('WIDGET_MESSAGE_STORE');

export interface WidgetTokenRow {
  id: string;
  tokenHash: string;
  agentId: string;
  label: string | null;
  allowedOrigins: string[];
  isActive: boolean;
  expiresAt: Date | null;
  lastUsedAt: Date | null;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewWidgetToken {
  tokenHash: string;
  agentId: string;
  label: string | null;
  allowedOrigins: string[];
  isActive: boolean;
  expiresAt: Date | null;
  createdBy: string;
}

export interface WidgetTokenStore {
  /** Guard lookup (plan 4.12): active only; expiry is checked in code (parity). */
  findActiveByHash(tokenHash: string): Promise<WidgetTokenRow | null>;
  /** One write per minute per row, as in the connected-app store (plan 4.12). */
  touchLastUsedThrottled(tokenHash: string): Promise<void>;
  /** Active + unexpired existence (hasActiveToken). */
  existsActiveForAgent(agentId: string): Promise<boolean>;
  listByAgent(agentId: string): Promise<WidgetTokenRow[]>;
  insert(row: NewWidgetToken): Promise<WidgetTokenRow>;
  update(
    agentId: string,
    tokenId: string,
    patch: Partial<Pick<NewWidgetToken, 'label' | 'allowedOrigins' | 'isActive' | 'expiresAt'>>,
  ): Promise<WidgetTokenRow | null>;
  /** Revoke = delete (parity with findOneAndDelete). */
  delete(agentId: string, tokenId: string): Promise<WidgetTokenRow | null>;
  /** Agent delete teardown (plan 4.6): deactivate instead of delete (FK cascade is the safety net). */
  revokeAllForAgent(agentId: string): Promise<void>;
}

export interface WidgetSessionRow {
  id: string;
  tokenHash: string;
  agentId: string;
  visitorId: string;
  metadata: Record<string, unknown>;
  clientContext: Record<string, unknown>;
  appSource: Record<string, unknown>;
  geo: Record<string, unknown>;
  status: string;
  messageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewWidgetSession {
  tokenHash: string;
  agentId: string;
  visitorId: string;
  metadata: Record<string, unknown>;
  clientContext: Record<string, unknown>;
  appSource: Record<string, unknown>;
  geo: Record<string, unknown>;
}

export interface WidgetSessionStore {
  /**
   * Plan 4.13 race fix: INSERT … ON CONFLICT (token_hash, visitor_id)
   * WHERE status='active' DO NOTHING RETURNING *, then SELECT the active
   * row when nothing is returned.
   */
  createOrGetSession(row: NewWidgetSession): Promise<{ session: WidgetSessionRow; created: boolean }>;
  /** Plan 4.13: close active + insert new in ONE transaction. */
  resetVisitorSession(row: NewWidgetSession): Promise<{ session: WidgetSessionRow; closedSessionIds: string[] }>;
  /** SSE auth (plan 4.14): WHERE id AND token_hash AND agent_id AND status='active'. */
  findByIdWithAgent(id: string, tokenHash: string, agentId: string): Promise<WidgetSessionRow | null>;
  incrementMessageCount(id: string): Promise<void>;
}

export interface WidgetMessageInput {
  sessionId: string;
  tokenHash: string;
  agentId: string;
  role: 'user' | 'assistant';
  content: string;
  components?: unknown[];
  interaction?: Record<string, unknown> | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
}

export interface WidgetMessageStore {
  /** Plan 4.14: INSERT + session message_count increment in the SAME transaction. */
  insert(input: WidgetMessageInput): Promise<{ id: string }>;
}
