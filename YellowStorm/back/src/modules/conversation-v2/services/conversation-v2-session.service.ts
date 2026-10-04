import { Injectable } from '@nestjs/common';
import { isObjectId } from '@common/postgres';
import { ListSessionsDto } from '../dto/list-sessions.dto';
import type {
  ConversationV2DeployStatus,
  ConversationV2SessionStatus,
} from '../types/conversation-v2-persistence.types';
import {
  type ConversationV2SessionRecord,  
} from '../persistence/conversation-v2-session.store';
import { PgConversationV2SessionStore } from '../persistence/postgres/pg-conversation-v2-session.store';

export type { ConversationV2SessionStatus, ConversationV2DeployStatus };

export interface PointerSummary {
  sessionId: string;
  title: string;
  status: ConversationV2SessionStatus;
  lastEventAt: string;
  isShared: boolean;
  workspaceIds: string[];
  selectedSkillIds: string[];
  selectedConnectorIds: string[];
}

export interface AppRevisionCatalogFields {
  lastDeployedRevisionId: string | null;
  latestFinalizedRevisionId: string | null;
  latestFinalizedAt: string | null;
  finalizedVersionCount: number;
}

export interface DeployedAppSummary extends AppRevisionCatalogFields {
  sessionId: string;
  title: string;
  deployedUrl: string;
  lastDeployedAt: string | null;
  source: 'owned' | 'shared';
  shareId: string | null;
  /** Recipient may open the conversation with full access (shared apps only). */
  canOpenConversation: boolean;
  /** Generated app integrates Approach B AI features. */
  hasAiFeatures: boolean;
}

export interface DraftAppSummary extends AppRevisionCatalogFields {
  sessionId: string;
  title: string;
  lastUpdatedAt: string;
  deployStatus: Exclude<ConversationV2DeployStatus, 'deployed'>;
  /** Generated app integrates Approach B AI features. */
  hasAiFeatures: boolean;
}

export interface SessionRevisionContext {
  aiSessionId: string | null;
  lastDeployedRevisionId: string | null;
  hasAiFeatures: boolean;
  aiFeaturesCheckedRevisionId: string | null;
}

const EMPTY_REVISION_CATALOG: AppRevisionCatalogFields = {
  lastDeployedRevisionId: null,
  latestFinalizedRevisionId: null,
  latestFinalizedAt: null,
  finalizedVersionCount: 0,
};

@Injectable()
export class ConversationV2SessionService {
  constructor(
    private readonly store: PgConversationV2SessionStore,
  ) {}

  /**
   * Insert an empty pointer (draft) and return it. The returned record has a
   * fresh id but no aiSessionId or systemWorkspaceId yet — those are
   * populated by `attachAiSession` after gRPC + workspace creation succeed.
   */
  async createDraft(
    ownerId: string,
    workspaceIds: string[] = [],
  ): Promise<ConversationV2SessionRecord> {
    return this.store.createDraft(ownerId, workspaceIds);
  }

  /**
   * Finalize a draft pointer: set the gRPC session id and the system
   * workspace id. Filter requires `aiSessionId: null` so a second writer
   * (e.g. retry) doesn't clobber an already-finalized session.
   */
  async attachAiSession(
    id: string,
    aiSessionId: string,
    systemWorkspaceId: string,
  ): Promise<void> {
    await this.store.attachAiSession(id, aiSessionId, systemWorkspaceId);
  }

  /**
   * Hard-delete a draft pointer. Safety: refuses to touch any pointer that
   * isn't still a draft (aiSessionId set OR deletedAt set means it's a real
   * session — `softDelete` is the right path for those).
   */
  async deleteDraft(id: string): Promise<void> {
    await this.store.deleteDraft(id);
  }

  /**
   * List the owner's successfully deployed apps (sessions with a live URL),
   * newest deployment first. Powers the App Marketplace page.
   */
  async listDeployedApps(ownerId: string): Promise<DeployedAppSummary[]> {
    const docs = await this.store.listDeployedApps(ownerId);
    return docs.map((doc) => ({
      sessionId: doc.id,
      title: doc.deployedAppTitle ?? doc.title ?? '',
      deployedUrl: doc.deployedUrl!,
      lastDeployedAt: doc.lastDeployedAt ? doc.lastDeployedAt.toISOString() : null,
      source: 'owned' as const,
      shareId: null,
      canOpenConversation: true,
      hasAiFeatures: doc.hasAiFeatures,
      ...EMPTY_REVISION_CATALOG,
    }));
  }

  /**
   * List the owner's in-progress app conversations that have not been published
   * yet (or were unpublished from App Builder). Requires at least one persisted
   * event so empty sessions do not appear as drafts.
   */
  async listDraftApps(ownerId: string): Promise<DraftAppSummary[]> {
    const docs = await this.store.listDraftApps(ownerId);
    return docs.map((doc) => ({
      sessionId: doc.id,
      title: doc.deployedAppTitle ?? doc.title ?? '',
      lastUpdatedAt: doc.lastEventAt.toISOString(),
      deployStatus: (doc.deployStatus as DraftAppSummary['deployStatus']) ?? 'idle',
      hasAiFeatures: doc.hasAiFeatures,
      ...EMPTY_REVISION_CATALOG,
    }));
  }

  async resolveRevisionContextBySessionIds(
    sessionIds: string[],
  ): Promise<Map<string, SessionRevisionContext>> {
    const uniqueIds = [...new Set(sessionIds.filter((id) => isObjectId(id)))];
    if (!uniqueIds.length) return new Map();

    const docs = await this.store.findByIds(uniqueIds);
    return new Map(
      docs.map((doc) => [
        doc.id,
        {
          aiSessionId:
            typeof doc.aiSessionId === 'string' && doc.aiSessionId.trim()
              ? doc.aiSessionId.trim()
              : null,
          lastDeployedRevisionId:
            typeof doc.lastDeployedRevisionId === 'string' &&
            doc.lastDeployedRevisionId.trim()
              ? doc.lastDeployedRevisionId.trim()
              : null,
          hasAiFeatures: doc.hasAiFeatures,
          aiFeaturesCheckedRevisionId:
            typeof doc.aiFeaturesCheckedRevisionId === 'string' &&
            doc.aiFeaturesCheckedRevisionId.trim()
              ? doc.aiFeaturesCheckedRevisionId.trim()
              : null,
        },
      ]),
    );
  }

  /**
   * Persist App Builder AI capability flag. When `checkedRevisionId` is null,
   * only force `hasAiFeatures` (e.g. runtime AI proxy usage) without clearing
   * a prior checked revision.
   */
  async setAiFeaturesFlag(
    sessionId: string,
    hasAiFeatures: boolean,
    checkedRevisionId: string | null,
  ): Promise<void> {
    await this.store.setAiFeaturesFlag(sessionId, hasAiFeatures, checkedRevisionId);
  }

  /**
   * Stamp the revision that was scanned for AI usage without clearing a prior
   * `hasAiFeatures: true` (runtime proof must survive a negative static scan).
   * Returns the effective flag after the write.
   */
  async recordAiFeaturesCheckedWithoutDemote(
    sessionId: string,
    checkedRevisionId: string,
  ): Promise<boolean> {
    return this.store.recordAiFeaturesCheckedWithoutDemote(sessionId, checkedRevisionId);
  }

  async list(ownerId: string, dto: ListSessionsDto): Promise<PointerSummary[]> {
    const docs = await this.store.listByOwner({
      ownerId,
      cursor: dto.cursor ? new Date(dto.cursor) : undefined,
      q: dto.q,
      limit: dto.limit ?? 20,
    });
    return docs.map(this.toSummary);
  }

  async getOne(ownerId: string, id: string): Promise<ConversationV2SessionRecord | null> {
    return this.store.findByOwnerAndId(ownerId, id);
  }

  /** Load a non-deleted session by id regardless of owner (caller must authorize). */
  async getById(id: string): Promise<ConversationV2SessionRecord | null> {
    return this.store.findById(id);
  }

  /**
   * App-runtime workspace id is the APImanus session id. Event persistence
   * still keys on the YellowStorm pointer id.
   */
  async findByAiSessionId(
    aiSessionId: string,
  ): Promise<ConversationV2SessionRecord | null> {
    return this.store.findByAiSessionId(aiSessionId);
  }

  async getByShareToken(shareTokenHash: string): Promise<ConversationV2SessionRecord | null> {
    return this.store.findByShareToken(shareTokenHash);
  }

  async rename(ownerId: string, id: string, title: string) {
    return this.store.rename(ownerId, id, title);
  }

  async setShared(
    ownerId: string,
    id: string,
    isShared: boolean,
    shareTokenHash: string | null,
  ) {
    return this.store.setShared(ownerId, id, isShared, shareTokenHash);
  }

  async setDeployState(
    ownerId: string,
    id: string,
    patch: {
      deployStatus?: ConversationV2DeployStatus;
      deployedUrl?: string | null;
      deployedAppTitle?: string | null;
      lastDeployedAt?: Date | null;
      lastDeployedRevisionId?: string | null;
    },
  ) {
    return this.store.setDeployState(ownerId, id, patch);
  }

  /** Remove a deployed app from Marketplace without deleting its conversation. */
  async removeDeployedApp(ownerId: string, id: string) {
    return this.store.removeDeployedApp(ownerId, id);
  }

  /**
   * Persist the skill selection for a session. Called on every message send so
   * the stored set always reflects the latest selection (mirrors v1's
   * conversation-level `selectedSkills`). Re-display only — no access checks.
   */
  async setSelectedSkills(id: string, skillIds: string[]): Promise<void> {
    await this.store.setSelectedSkills(id, skillIds);
  }

  /**
   * Persist the connector selection for a session (mirrors setSelectedSkills),
   * so the UI re-displays the selected connectors on reload. Re-display only.
   */
  async setSelectedConnectors(id: string, connectorIds: string[]): Promise<void> {
    await this.store.setSelectedConnectors(id, connectorIds);
  }

  async softDelete(ownerId: string, id: string) {
    return this.store.softDelete(ownerId, id);
  }

  private toSummary = (doc: ConversationV2SessionRecord): PointerSummary => ({
    sessionId: doc.id,
    title: doc.title ?? '',
    status: doc.status,
    lastEventAt: (doc.lastEventAt ?? new Date(0)).toISOString(),
    isShared: doc.isShared ?? false,
    workspaceIds: doc.workspaceIds ?? [],
    selectedSkillIds: doc.selectedSkillIds ?? [],
    selectedConnectorIds: doc.selectedConnectorIds ?? [],
  });
}
