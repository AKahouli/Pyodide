import { Inject } from '@nestjs/common';
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId } from '@common/postgres';
import { escapeLike } from '@common/postgres/like';
import { resolveQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type {
  ConversationV2DeployStatus,
  ConversationV2SessionStatus,
} from '../../types/conversation-v2-persistence.types';
import type {
  ConversationV2SessionDeployPatch,
  ConversationV2SessionListFilter,
  ConversationV2SessionPointerPatch,
  ConversationV2SessionRecord,
  ConversationV2SessionStore,
} from '../conversation-v2-session.store';

type SessionRow = typeof schema.conversationV2Sessions.$inferSelect;

export class PgConversationV2SessionStore implements ConversationV2SessionStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): NodePgDatabase<typeof schema> {
    return resolveQueryable(this.db);
  }

  private static toRecord(row: SessionRow): ConversationV2SessionRecord {
    return {
      id: row.id,
      ownerId: row.ownerId,
      aiSessionId: row.aiSessionId ?? null,
      title: row.title,
      status: row.status as ConversationV2SessionStatus,
      lastEventAt: row.lastEventAt,
      isShared: row.isShared,
      shareTokenHash: row.shareTokenHash ?? null,
      deletedAt: row.deletedAt ?? null,
      deployStatus: row.deployStatus as ConversationV2DeployStatus,
      deployedUrl: row.deployedUrl ?? null,
      deployedAppTitle: row.deployedAppTitle ?? null,
      lastDeployedAt: row.lastDeployedAt ?? null,
      lastDeployedRevisionId: row.lastDeployedRevisionId ?? null,
      hasAiFeatures: row.hasAiFeatures,
      aiFeaturesCheckedRevisionId: row.aiFeaturesCheckedRevisionId ?? null,
      workspaceIds: row.workspaceIds ?? [],
      selectedSkillIds: row.selectedSkillIds ?? [],
      selectedConnectorIds: row.selectedConnectorIds ?? [],
      eventSequence: row.eventSequence,
      eventCount: row.eventCount,
      systemWorkspaceId: row.systemWorkspaceId ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async createDraft(ownerId: string, workspaceIds: string[]): Promise<ConversationV2SessionRecord> {
    const id = newObjectId();
    const [row] = await this.q
      .insert(schema.conversationV2Sessions)
      .values({
        id,
        ownerId: normalizeObjectId(ownerId),
        aiSessionId: null,
        title: '',
        status: 'active',
        lastEventAt: new Date(),
        isShared: false,
        shareTokenHash: null,
        deletedAt: null,
        deployStatus: 'idle',
        deployedUrl: null,
        deployedAppTitle: null,
        lastDeployedAt: null,
        workspaceIds: workspaceIds.map(normalizeObjectId),
        eventSequence: 0,
        eventCount: 0,
        systemWorkspaceId: null,
      })
      .returning();
    return PgConversationV2SessionStore.toRecord(row);
  }

  async attachAiSession(id: string, aiSessionId: string, systemWorkspaceId: string): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .update(schema.conversationV2Sessions)
      .set({
        aiSessionId,
        systemWorkspaceId: normalizeObjectId(systemWorkspaceId),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.conversationV2Sessions.id, normalizeObjectId(id)),
          isNull(schema.conversationV2Sessions.aiSessionId),
        ),
      );
  }

  async deleteDraft(id: string): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .delete(schema.conversationV2Sessions)
      .where(
        and(
          eq(schema.conversationV2Sessions.id, normalizeObjectId(id)),
          isNull(schema.conversationV2Sessions.aiSessionId),
          isNull(schema.conversationV2Sessions.deletedAt),
        ),
      );
  }

  async findById(
    id: string,
    options?: { includeDeleted?: boolean },
  ): Promise<ConversationV2SessionRecord | null> {
    if (!isObjectId(id)) return null;
    const conditions = [eq(schema.conversationV2Sessions.id, normalizeObjectId(id))];
    if (!options?.includeDeleted) {
      conditions.push(isNull(schema.conversationV2Sessions.deletedAt));
    }
    const [row] = await this.q
      .select()
      .from(schema.conversationV2Sessions)
      .where(and(...conditions))
      .limit(1);
    return row ? PgConversationV2SessionStore.toRecord(row) : null;
  }

  async findByOwnerAndId(ownerId: string, id: string): Promise<ConversationV2SessionRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .select()
      .from(schema.conversationV2Sessions)
      .where(
        and(
          eq(schema.conversationV2Sessions.id, normalizeObjectId(id)),
          eq(schema.conversationV2Sessions.ownerId, normalizeObjectId(ownerId)),
          isNull(schema.conversationV2Sessions.deletedAt),
        ),
      )
      .limit(1);
    return row ? PgConversationV2SessionStore.toRecord(row) : null;
  }

  async findByAiSessionId(aiSessionId: string): Promise<ConversationV2SessionRecord | null> {
    if (!aiSessionId) return null;
    const [row] = await this.q
      .select()
      .from(schema.conversationV2Sessions)
      .where(
        and(
          eq(schema.conversationV2Sessions.aiSessionId, aiSessionId),
          isNull(schema.conversationV2Sessions.deletedAt),
        ),
      )
      .limit(1);
    return row ? PgConversationV2SessionStore.toRecord(row) : null;
  }

  async findByShareToken(shareTokenHash: string): Promise<ConversationV2SessionRecord | null> {
    const [row] = await this.q
      .select()
      .from(schema.conversationV2Sessions)
      .where(
        and(
          eq(schema.conversationV2Sessions.shareTokenHash, shareTokenHash),
          eq(schema.conversationV2Sessions.isShared, true),
          isNull(schema.conversationV2Sessions.deletedAt),
        ),
      )
      .limit(1);
    return row ? PgConversationV2SessionStore.toRecord(row) : null;
  }

  async findByIds(ids: string[]): Promise<ConversationV2SessionRecord[]> {
    const unique = [...new Set(ids.filter(isObjectId).map(normalizeObjectId))];
    if (!unique.length) return [];
    const rows = await this.q
      .select()
      .from(schema.conversationV2Sessions)
      .where(
        and(
          inArray(schema.conversationV2Sessions.id, unique),
          isNull(schema.conversationV2Sessions.deletedAt),
        ),
      );
    return rows.map(PgConversationV2SessionStore.toRecord);
  }

  async listByOwner(filter: ConversationV2SessionListFilter): Promise<ConversationV2SessionRecord[]> {
    const conditions = [
      eq(schema.conversationV2Sessions.ownerId, normalizeObjectId(filter.ownerId)),
      isNull(schema.conversationV2Sessions.deletedAt),
    ];
    if (filter.cursor) {
      conditions.push(sql`${schema.conversationV2Sessions.lastEventAt} < ${filter.cursor}`);
    }
    if (filter.q) {
      conditions.push(ilike(schema.conversationV2Sessions.title, `%${escapeLike(filter.q)}%`));
    }
    const rows = await this.q
      .select()
      .from(schema.conversationV2Sessions)
      .where(and(...conditions))
      .orderBy(desc(schema.conversationV2Sessions.lastEventAt))
      .limit(filter.limit);
    return rows.map(PgConversationV2SessionStore.toRecord);
  }

  async listDeployedApps(ownerId: string): Promise<ConversationV2SessionRecord[]> {
    const rows = await this.q
      .select()
      .from(schema.conversationV2Sessions)
      .where(
        and(
          eq(schema.conversationV2Sessions.ownerId, normalizeObjectId(ownerId)),
          isNull(schema.conversationV2Sessions.deletedAt),
          eq(schema.conversationV2Sessions.deployStatus, 'deployed'),
          isNotNull(schema.conversationV2Sessions.deployedUrl),
        ),
      )
      .orderBy(desc(schema.conversationV2Sessions.lastDeployedAt));
    return rows.map(PgConversationV2SessionStore.toRecord);
  }

  async listDraftApps(ownerId: string): Promise<ConversationV2SessionRecord[]> {
    const rows = await this.q
      .select()
      .from(schema.conversationV2Sessions)
      .where(
        and(
          eq(schema.conversationV2Sessions.ownerId, normalizeObjectId(ownerId)),
          isNull(schema.conversationV2Sessions.deletedAt),
          isNotNull(schema.conversationV2Sessions.aiSessionId),
          gt(schema.conversationV2Sessions.eventCount, 0),
          or(
            ne(schema.conversationV2Sessions.deployStatus, 'deployed'),
            isNull(schema.conversationV2Sessions.deployedUrl),
          ),
        ),
      )
      .orderBy(desc(schema.conversationV2Sessions.lastEventAt));
    return rows.map(PgConversationV2SessionStore.toRecord);
  }

  async rename(ownerId: string, id: string, title: string): Promise<ConversationV2SessionRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(schema.conversationV2Sessions)
      .set({ title, updatedAt: new Date() })
      .where(
        and(
          eq(schema.conversationV2Sessions.id, normalizeObjectId(id)),
          eq(schema.conversationV2Sessions.ownerId, normalizeObjectId(ownerId)),
          isNull(schema.conversationV2Sessions.deletedAt),
        ),
      )
      .returning();
    return row ? PgConversationV2SessionStore.toRecord(row) : null;
  }

  async setShared(
    ownerId: string,
    id: string,
    isShared: boolean,
    shareTokenHash: string | null,
  ): Promise<ConversationV2SessionRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(schema.conversationV2Sessions)
      .set({ isShared, shareTokenHash, updatedAt: new Date() })
      .where(
        and(
          eq(schema.conversationV2Sessions.id, normalizeObjectId(id)),
          eq(schema.conversationV2Sessions.ownerId, normalizeObjectId(ownerId)),
          isNull(schema.conversationV2Sessions.deletedAt),
        ),
      )
      .returning();
    return row ? PgConversationV2SessionStore.toRecord(row) : null;
  }

  async setDeployState(
    ownerId: string,
    id: string,
    patch: ConversationV2SessionDeployPatch,
  ): Promise<ConversationV2SessionRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(schema.conversationV2Sessions)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(schema.conversationV2Sessions.id, normalizeObjectId(id)),
          eq(schema.conversationV2Sessions.ownerId, normalizeObjectId(ownerId)),
          isNull(schema.conversationV2Sessions.deletedAt),
        ),
      )
      .returning();
    return row ? PgConversationV2SessionStore.toRecord(row) : null;
  }

  async removeDeployedApp(ownerId: string, id: string): Promise<ConversationV2SessionRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(schema.conversationV2Sessions)
      .set({
        deployStatus: 'idle',
        deployedUrl: null,
        deployedAppTitle: null,
        lastDeployedAt: null,
        lastDeployedRevisionId: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.conversationV2Sessions.id, normalizeObjectId(id)),
          eq(schema.conversationV2Sessions.ownerId, normalizeObjectId(ownerId)),
          isNull(schema.conversationV2Sessions.deletedAt),
          eq(schema.conversationV2Sessions.deployStatus, 'deployed'),
        ),
      )
      .returning();
    return row ? PgConversationV2SessionStore.toRecord(row) : null;
  }

  async setSelectedSkills(id: string, skillIds: string[]): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .update(schema.conversationV2Sessions)
      .set({
        selectedSkillIds: skillIds.map(normalizeObjectId),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.conversationV2Sessions.id, normalizeObjectId(id)),
          isNull(schema.conversationV2Sessions.deletedAt),
        ),
      );
  }

  async setSelectedConnectors(id: string, connectorIds: string[]): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .update(schema.conversationV2Sessions)
      .set({
        selectedConnectorIds: connectorIds.map(normalizeObjectId),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.conversationV2Sessions.id, normalizeObjectId(id)),
          isNull(schema.conversationV2Sessions.deletedAt),
        ),
      );
  }

  async setAiFeaturesFlag(
    sessionId: string,
    hasAiFeatures: boolean,
    checkedRevisionId: string | null,
  ): Promise<void> {
    if (!isObjectId(sessionId)) return;
    const patch: Record<string, unknown> = { hasAiFeatures, updatedAt: new Date() };
    if (checkedRevisionId) {
      patch.aiFeaturesCheckedRevisionId = checkedRevisionId;
    }
    await this.q
      .update(schema.conversationV2Sessions)
      .set(patch)
      .where(
        and(
          eq(schema.conversationV2Sessions.id, normalizeObjectId(sessionId)),
          isNull(schema.conversationV2Sessions.deletedAt),
        ),
      );
  }

  async recordAiFeaturesCheckedWithoutDemote(
    sessionId: string,
    checkedRevisionId: string,
  ): Promise<boolean> {
    if (!isObjectId(sessionId)) return false;
    const id = normalizeObjectId(sessionId);
    await this.q
      .update(schema.conversationV2Sessions)
      .set({ aiFeaturesCheckedRevisionId: checkedRevisionId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.conversationV2Sessions.id, id),
          isNull(schema.conversationV2Sessions.deletedAt),
        ),
      );
    await this.q
      .update(schema.conversationV2Sessions)
      .set({ hasAiFeatures: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.conversationV2Sessions.id, id),
          isNull(schema.conversationV2Sessions.deletedAt),
          ne(schema.conversationV2Sessions.hasAiFeatures, true),
        ),
      );
    const record = await this.findById(id);
    return record?.hasAiFeatures === true;
  }

  async softDelete(ownerId: string, id: string): Promise<ConversationV2SessionRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(schema.conversationV2Sessions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.conversationV2Sessions.id, normalizeObjectId(id)),
          eq(schema.conversationV2Sessions.ownerId, normalizeObjectId(ownerId)),
          isNull(schema.conversationV2Sessions.deletedAt),
        ),
      )
      .returning();
    return row ? PgConversationV2SessionStore.toRecord(row) : null;
  }

  async applyPointerPatch(id: string, patch: ConversationV2SessionPointerPatch): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .update(schema.conversationV2Sessions)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.conversationV2Sessions.id, normalizeObjectId(id)));
  }

  async incrementEventCounters(id: string): Promise<number | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(schema.conversationV2Sessions)
      .set({
        eventSequence: sql`${schema.conversationV2Sessions.eventSequence} + 1`,
        eventCount: sql`${schema.conversationV2Sessions.eventCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.conversationV2Sessions.id, normalizeObjectId(id)))
      .returning({ eventSequence: schema.conversationV2Sessions.eventSequence });
    return row?.eventSequence ?? null;
  }

  async countWithAiFeatures(): Promise<number> {
    const [row] = await this.q
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.conversationV2Sessions)
      .where(
        and(
          eq(schema.conversationV2Sessions.hasAiFeatures, true),
          isNull(schema.conversationV2Sessions.deletedAt),
        ),
      );
    return Number(row?.count ?? 0);
  }

  async countWithAiFeaturesByOwners(ownerIds: string[]): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    const ids = ownerIds.filter(isObjectId).map(normalizeObjectId);
    if (!ids.length) return out;
    const rows = await this.q
      .select({
        ownerId: schema.conversationV2Sessions.ownerId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.conversationV2Sessions)
      .where(
        and(
          inArray(schema.conversationV2Sessions.ownerId, ids),
          eq(schema.conversationV2Sessions.hasAiFeatures, true),
          isNull(schema.conversationV2Sessions.deletedAt),
        ),
      )
      .groupBy(schema.conversationV2Sessions.ownerId);
    for (const row of rows) out.set(row.ownerId, Number(row.count ?? 0));
    return out;
  }

  async listWithAiFeaturesByOwner(ownerId: string): Promise<ConversationV2SessionRecord[]> {
    if (!isObjectId(ownerId)) return [];
    const rows = await this.q
      .select()
      .from(schema.conversationV2Sessions)
      .where(
        and(
          eq(schema.conversationV2Sessions.ownerId, normalizeObjectId(ownerId)),
          eq(schema.conversationV2Sessions.hasAiFeatures, true),
          isNull(schema.conversationV2Sessions.deletedAt),
        ),
      )
      .orderBy(desc(schema.conversationV2Sessions.updatedAt));
    return rows.map(PgConversationV2SessionStore.toRecord);
  }
}
