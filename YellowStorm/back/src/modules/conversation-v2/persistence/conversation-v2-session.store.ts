import type {
  ConversationV2DeployStatus,
  ConversationV2SessionStatus,
} from '../types/conversation-v2-persistence.types';


export interface ConversationV2SessionRecord {
  id: string;
  ownerId: string;
  aiSessionId: string | null;
  title: string;
  status: ConversationV2SessionStatus;
  lastEventAt: Date;
  isShared: boolean;
  shareTokenHash: string | null;
  deletedAt: Date | null;
  deployStatus: ConversationV2DeployStatus;
  deployedUrl: string | null;
  deployedAppTitle: string | null;
  lastDeployedAt: Date | null;
  lastDeployedRevisionId: string | null;
  hasAiFeatures: boolean;
  aiFeaturesCheckedRevisionId: string | null;
  workspaceIds: string[];
  selectedSkillIds: string[];
  selectedConnectorIds: string[];
  eventSequence: number;
  eventCount: number;
  systemWorkspaceId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationV2SessionListFilter {
  ownerId: string;
  cursor?: Date;
  q?: string;
  limit: number;
}

export interface ConversationV2SessionDeployPatch {
  deployStatus?: ConversationV2DeployStatus;
  deployedUrl?: string | null;
  deployedAppTitle?: string | null;
  lastDeployedAt?: Date | null;
  lastDeployedRevisionId?: string | null;
}

export interface ConversationV2SessionPointerPatch {
  lastEventAt?: Date;
  title?: string;
  status?: ConversationV2SessionStatus;
}

/**
 * Persistence port for conversation_v2.sessions (P8).
 * Callers never touch Drizzle / Mongoose directly.
 */
export interface ConversationV2SessionStore {
  createDraft(ownerId: string, workspaceIds: string[]): Promise<ConversationV2SessionRecord>;
  attachAiSession(id: string, aiSessionId: string, systemWorkspaceId: string): Promise<void>;
  deleteDraft(id: string): Promise<void>;
  findById(id: string, options?: { includeDeleted?: boolean }): Promise<ConversationV2SessionRecord | null>;
  findByOwnerAndId(ownerId: string, id: string): Promise<ConversationV2SessionRecord | null>;
  findByAiSessionId(aiSessionId: string): Promise<ConversationV2SessionRecord | null>;
  findByShareToken(shareTokenHash: string): Promise<ConversationV2SessionRecord | null>;
  findByIds(ids: string[]): Promise<ConversationV2SessionRecord[]>;
  listByOwner(filter: ConversationV2SessionListFilter): Promise<ConversationV2SessionRecord[]>;
  listDeployedApps(ownerId: string): Promise<ConversationV2SessionRecord[]>;
  listDraftApps(ownerId: string): Promise<ConversationV2SessionRecord[]>;
  rename(ownerId: string, id: string, title: string): Promise<ConversationV2SessionRecord | null>;
  setShared(
    ownerId: string,
    id: string,
    isShared: boolean,
    shareTokenHash: string | null,
  ): Promise<ConversationV2SessionRecord | null>;
  setDeployState(
    ownerId: string,
    id: string,
    patch: ConversationV2SessionDeployPatch,
  ): Promise<ConversationV2SessionRecord | null>;
  removeDeployedApp(ownerId: string, id: string): Promise<ConversationV2SessionRecord | null>;
  setSelectedSkills(id: string, skillIds: string[]): Promise<void>;
  setSelectedConnectors(id: string, connectorIds: string[]): Promise<void>;
  setAiFeaturesFlag(
    sessionId: string,
    hasAiFeatures: boolean,
    checkedRevisionId: string | null,
  ): Promise<void>;
  recordAiFeaturesCheckedWithoutDemote(
    sessionId: string,
    checkedRevisionId: string,
  ): Promise<boolean>;
  softDelete(ownerId: string, id: string): Promise<ConversationV2SessionRecord | null>;
  applyPointerPatch(id: string, patch: ConversationV2SessionPointerPatch): Promise<void>;
  /**
   * Atomically bump event_sequence and event_count; returns the new sequence.
   * Used by the event store append path.
   */
  incrementEventCounters(id: string): Promise<number | null>;
  /** Admin: count non-deleted sessions with has_ai_features. */
  countWithAiFeatures(): Promise<number>;
  /** Admin: per-owner counts of AI-featured sessions. */
  countWithAiFeaturesByOwners(ownerIds: string[]): Promise<Map<string, number>>;
  /** Admin: list AI-featured sessions for one owner. */
  listWithAiFeaturesByOwner(ownerId: string): Promise<ConversationV2SessionRecord[]>;
}
