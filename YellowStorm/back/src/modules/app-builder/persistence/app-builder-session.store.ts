import type {
  AppBuilderDeployStatus,
  AppBuilderSessionStatus,
} from '../types/app-builder-persistence.types';


export interface AppBuilderSessionRecord {
  id: string;
  ownerId: string;
  aiSessionId: string | null;
  title: string;
  status: AppBuilderSessionStatus;
  lastEventAt: Date;
  isShared: boolean;
  shareTokenHash: string | null;
  deletedAt: Date | null;
  deployStatus: AppBuilderDeployStatus;
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
  /** Revision the browser runtime boots on (template `template_<id>` or system starter). */
  starterRevisionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface AppBuilderSessionListFilter {
  ownerId: string;
  cursor?: Date;
  q?: string;
  limit: number;
}

export interface AppBuilderSessionDeployPatch {
  deployStatus?: AppBuilderDeployStatus;
  deployedUrl?: string | null;
  deployedAppTitle?: string | null;
  lastDeployedAt?: Date | null;
  lastDeployedRevisionId?: string | null;
}

export interface AppBuilderSessionPointerPatch {
  lastEventAt?: Date;
  title?: string;
  status?: AppBuilderSessionStatus;
}

/**
 * Persistence port for conversation_v2.sessions (P8).
 * Callers never touch Drizzle / Mongoose directly.
 */
export interface AppBuilderSessionStore {
  createDraft(
    ownerId: string,
    workspaceIds: string[],
    starterRevisionId?: string,
  ): Promise<AppBuilderSessionRecord>;
  attachAiSession(id: string, aiSessionId: string, systemWorkspaceId: string): Promise<void>;
  deleteDraft(id: string): Promise<void>;
  findById(id: string, options?: { includeDeleted?: boolean }): Promise<AppBuilderSessionRecord | null>;
  findByOwnerAndId(ownerId: string, id: string): Promise<AppBuilderSessionRecord | null>;
  findByAiSessionId(aiSessionId: string): Promise<AppBuilderSessionRecord | null>;
  findByShareToken(shareTokenHash: string): Promise<AppBuilderSessionRecord | null>;
  findByIds(ids: string[]): Promise<AppBuilderSessionRecord[]>;
  listByOwner(filter: AppBuilderSessionListFilter): Promise<AppBuilderSessionRecord[]>;
  listDeployedApps(ownerId: string): Promise<AppBuilderSessionRecord[]>;
  listDraftApps(ownerId: string): Promise<AppBuilderSessionRecord[]>;
  rename(ownerId: string, id: string, title: string): Promise<AppBuilderSessionRecord | null>;
  setShared(
    ownerId: string,
    id: string,
    isShared: boolean,
    shareTokenHash: string | null,
  ): Promise<AppBuilderSessionRecord | null>;
  setDeployState(
    ownerId: string,
    id: string,
    patch: AppBuilderSessionDeployPatch,
  ): Promise<AppBuilderSessionRecord | null>;
  removeDeployedApp(ownerId: string, id: string): Promise<AppBuilderSessionRecord | null>;
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
  softDelete(ownerId: string, id: string): Promise<AppBuilderSessionRecord | null>;
  applyPointerPatch(id: string, patch: AppBuilderSessionPointerPatch): Promise<void>;
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
  listWithAiFeaturesByOwner(ownerId: string): Promise<AppBuilderSessionRecord[]>;
}
