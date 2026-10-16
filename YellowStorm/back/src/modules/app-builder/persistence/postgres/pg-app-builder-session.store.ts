import { Inject } from '@nestjs/common';
import { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId } from '@common/postgres';
import { escapeLike } from '@common/postgres/like';
import { resolveQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type {
  AppBuilderDeployStatus,
  AppBuilderSessionStatus,
} from '../../types/app-builder-persistence.types';
import type {
  AppBuilderSessionDeployPatch,
  AppBuilderSessionListFilter,
  AppBuilderSessionPointerPatch,
  AppBuilderSessionRecord,
  AppBuilderSessionStore,
} from '../app-builder-session.store';

type SessionRow = typeof schema.appBuilderSessions.$inferSelect;

export class PgAppBuilderSessionStore implements AppBuilderSessionStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): NodePgDatabase<typeof schema> {
    return resolveQueryable(this.db);
  }

  private static toRecord(row: SessionRow): AppBuilderSessionRecord {
    return {
      id: row.id,
      ownerId: row.ownerId,
      aiSessionId: row.aiSessionId ?? null,
      title: row.title,
      status: row.status as AppBuilderSessionStatus,
      lastEventAt: row.lastEventAt,
      isShared: row.isShared,
      shareTokenHash: row.shareTokenHash ?? null,
      deletedAt: row.deletedAt ?? null,
      deployStatus: row.deployStatus as AppBuilderDeployStatus,
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
      starterRevisionId: row.starterRevisionId ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  async createDraft(
    ownerId: string,
    workspaceIds: string[],
    starterRevisionId?: string,
  ): Promise<AppBuilderSessionRecord> {
    const id = newObjectId();
    const [row] = await this.q
      .insert(schema.appBuilderSessions)
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
        starterRevisionId: starterRevisionId ?? null,
      })
      .returning();
    return PgAppBuilderSessionStore.toRecord(row);
  }

  async attachAiSession(id: string, aiSessionId: string, systemWorkspaceId: string): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .update(schema.appBuilderSessions)
      .set({
        aiSessionId,
        systemWorkspaceId: normalizeObjectId(systemWorkspaceId),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.appBuilderSessions.id, normalizeObjectId(id)),
          isNull(schema.appBuilderSessions.aiSessionId),
        ),
      );
  }

  async deleteDraft(id: string): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .delete(schema.appBuilderSessions)
      .where(
        and(
          eq(schema.appBuilderSessions.id, normalizeObjectId(id)),
          isNull(schema.appBuilderSessions.aiSessionId),
          isNull(schema.appBuilderSessions.deletedAt),
        ),
      );
  }

  async findById(
    id: string,
    options?: { includeDeleted?: boolean },
  ): Promise<AppBuilderSessionRecord | null> {
    if (!isObjectId(id)) return null;
    const conditions = [eq(schema.appBuilderSessions.id, normalizeObjectId(id))];
    if (!options?.includeDeleted) {
      conditions.push(isNull(schema.appBuilderSessions.deletedAt));
    }
    const [row] = await this.q
      .select()
      .from(schema.appBuilderSessions)
      .where(and(...conditions))
      .limit(1);
    return row ? PgAppBuilderSessionStore.toRecord(row) : null;
  }

  async findByOwnerAndId(ownerId: string, id: string): Promise<AppBuilderSessionRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .select()
      .from(schema.appBuilderSessions)
      .where(
        and(
          eq(schema.appBuilderSessions.id, normalizeObjectId(id)),
          eq(schema.appBuilderSessions.ownerId, normalizeObjectId(ownerId)),
          isNull(schema.appBuilderSessions.deletedAt),
        ),
      )
      .limit(1);
    return row ? PgAppBuilderSessionStore.toRecord(row) : null;
  }

  async findByAiSessionId(aiSessionId: string): Promise<AppBuilderSessionRecord | null> {
    if (!aiSessionId) return null;
    const [row] = await this.q
      .select()
      .from(schema.appBuilderSessions)
      .where(
        and(
          eq(schema.appBuilderSessions.aiSessionId, aiSessionId),
          isNull(schema.appBuilderSessions.deletedAt),
        ),
      )
      .limit(1);
    return row ? PgAppBuilderSessionStore.toRecord(row) : null;
  }

  async findByShareToken(shareTokenHash: string): Promise<AppBuilderSessionRecord | null> {
    const [row] = await this.q
      .select()
      .from(schema.appBuilderSessions)
      .where(
        and(
          eq(schema.appBuilderSessions.shareTokenHash, shareTokenHash),
          eq(schema.appBuilderSessions.isShared, true),
          isNull(schema.appBuilderSessions.deletedAt),
        ),
      )
      .limit(1);
    return row ? PgAppBuilderSessionStore.toRecord(row) : null;
  }

  async findByIds(ids: string[]): Promise<AppBuilderSessionRecord[]> {
    const unique = [...new Set(ids.filter(isObjectId).map(normalizeObjectId))];
    if (!unique.length) return [];
    const rows = await this.q
      .select()
      .from(schema.appBuilderSessions)
      .where(
        and(
          inArray(schema.appBuilderSessions.id, unique),
          isNull(schema.appBuilderSessions.deletedAt),
        ),
      );
    return rows.map(PgAppBuilderSessionStore.toRecord);
  }

  async listByOwner(filter: AppBuilderSessionListFilter): Promise<AppBuilderSessionRecord[]> {
    const conditions = [
      eq(schema.appBuilderSessions.ownerId, normalizeObjectId(filter.ownerId)),
      isNull(schema.appBuilderSessions.deletedAt),
    ];
    if (filter.cursor) {
      conditions.push(sql`${schema.appBuilderSessions.lastEventAt} < ${filter.cursor}`);
    }
    if (filter.q) {
      conditions.push(ilike(schema.appBuilderSessions.title, `%${escapeLike(filter.q)}%`));
    }
    const rows = await this.q
      .select()
      .from(schema.appBuilderSessions)
      .where(and(...conditions))
      .orderBy(desc(schema.appBuilderSessions.lastEventAt))
      .limit(filter.limit);
    return rows.map(PgAppBuilderSessionStore.toRecord);
  }

  async listDeployedApps(ownerId: string): Promise<AppBuilderSessionRecord[]> {
    const rows = await this.q
      .select()
      .from(schema.appBuilderSessions)
      .where(
        and(
          eq(schema.appBuilderSessions.ownerId, normalizeObjectId(ownerId)),
          isNull(schema.appBuilderSessions.deletedAt),
          eq(schema.appBuilderSessions.deployStatus, 'deployed'),
          isNotNull(schema.appBuilderSessions.deployedUrl),
        ),
      )
      .orderBy(desc(schema.appBuilderSessions.lastDeployedAt));
    return rows.map(PgAppBuilderSessionStore.toRecord);
  }

  async listDraftApps(ownerId: string): Promise<AppBuilderSessionRecord[]> {
    const rows = await this.q
      .select()
      .from(schema.appBuilderSessions)
      .where(
        and(
          eq(schema.appBuilderSessions.ownerId, normalizeObjectId(ownerId)),
          isNull(schema.appBuilderSessions.deletedAt),
          isNotNull(schema.appBuilderSessions.aiSessionId),
          gt(schema.appBuilderSessions.eventCount, 0),
          or(
            ne(schema.appBuilderSessions.deployStatus, 'deployed'),
            isNull(schema.appBuilderSessions.deployedUrl),
          ),
        ),
      )
      .orderBy(desc(schema.appBuilderSessions.lastEventAt));
    return rows.map(PgAppBuilderSessionStore.toRecord);
  }

  async rename(ownerId: string, id: string, title: string): Promise<AppBuilderSessionRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(schema.appBuilderSessions)
      .set({ title, updatedAt: new Date() })
      .where(
        and(
          eq(schema.appBuilderSessions.id, normalizeObjectId(id)),
          eq(schema.appBuilderSessions.ownerId, normalizeObjectId(ownerId)),
          isNull(schema.appBuilderSessions.deletedAt),
        ),
      )
      .returning();
    return row ? PgAppBuilderSessionStore.toRecord(row) : null;
  }

  async setShared(
    ownerId: string,
    id: string,
    isShared: boolean,
    shareTokenHash: string | null,
  ): Promise<AppBuilderSessionRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(schema.appBuilderSessions)
      .set({ isShared, shareTokenHash, updatedAt: new Date() })
      .where(
        and(
          eq(schema.appBuilderSessions.id, normalizeObjectId(id)),
          eq(schema.appBuilderSessions.ownerId, normalizeObjectId(ownerId)),
          isNull(schema.appBuilderSessions.deletedAt),
        ),
      )
      .returning();
    return row ? PgAppBuilderSessionStore.toRecord(row) : null;
  }

  async setDeployState(
    ownerId: string,
    id: string,
    patch: AppBuilderSessionDeployPatch,
  ): Promise<AppBuilderSessionRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(schema.appBuilderSessions)
      .set({ ...patch, updatedAt: new Date() })
      .where(
        and(
          eq(schema.appBuilderSessions.id, normalizeObjectId(id)),
          eq(schema.appBuilderSessions.ownerId, normalizeObjectId(ownerId)),
          isNull(schema.appBuilderSessions.deletedAt),
        ),
      )
      .returning();
    return row ? PgAppBuilderSessionStore.toRecord(row) : null;
  }

  async removeDeployedApp(ownerId: string, id: string): Promise<AppBuilderSessionRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(schema.appBuilderSessions)
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
          eq(schema.appBuilderSessions.id, normalizeObjectId(id)),
          eq(schema.appBuilderSessions.ownerId, normalizeObjectId(ownerId)),
          isNull(schema.appBuilderSessions.deletedAt),
          eq(schema.appBuilderSessions.deployStatus, 'deployed'),
        ),
      )
      .returning();
    return row ? PgAppBuilderSessionStore.toRecord(row) : null;
  }

  async setSelectedSkills(id: string, skillIds: string[]): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .update(schema.appBuilderSessions)
      .set({
        selectedSkillIds: skillIds.map(normalizeObjectId),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.appBuilderSessions.id, normalizeObjectId(id)),
          isNull(schema.appBuilderSessions.deletedAt),
        ),
      );
  }

  async setSelectedConnectors(id: string, connectorIds: string[]): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .update(schema.appBuilderSessions)
      .set({
        selectedConnectorIds: connectorIds.map(normalizeObjectId),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.appBuilderSessions.id, normalizeObjectId(id)),
          isNull(schema.appBuilderSessions.deletedAt),
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
      .update(schema.appBuilderSessions)
      .set(patch)
      .where(
        and(
          eq(schema.appBuilderSessions.id, normalizeObjectId(sessionId)),
          isNull(schema.appBuilderSessions.deletedAt),
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
      .update(schema.appBuilderSessions)
      .set({ aiFeaturesCheckedRevisionId: checkedRevisionId, updatedAt: new Date() })
      .where(
        and(
          eq(schema.appBuilderSessions.id, id),
          isNull(schema.appBuilderSessions.deletedAt),
        ),
      );
    await this.q
      .update(schema.appBuilderSessions)
      .set({ hasAiFeatures: false, updatedAt: new Date() })
      .where(
        and(
          eq(schema.appBuilderSessions.id, id),
          isNull(schema.appBuilderSessions.deletedAt),
          ne(schema.appBuilderSessions.hasAiFeatures, true),
        ),
      );
    const record = await this.findById(id);
    return record?.hasAiFeatures === true;
  }

  async softDelete(ownerId: string, id: string): Promise<AppBuilderSessionRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(schema.appBuilderSessions)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(
        and(
          eq(schema.appBuilderSessions.id, normalizeObjectId(id)),
          eq(schema.appBuilderSessions.ownerId, normalizeObjectId(ownerId)),
          isNull(schema.appBuilderSessions.deletedAt),
        ),
      )
      .returning();
    return row ? PgAppBuilderSessionStore.toRecord(row) : null;
  }

  async applyPointerPatch(id: string, patch: AppBuilderSessionPointerPatch): Promise<void> {
    if (!isObjectId(id)) return;
    await this.q
      .update(schema.appBuilderSessions)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(schema.appBuilderSessions.id, normalizeObjectId(id)));
  }

  async incrementEventCounters(id: string): Promise<number | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q
      .update(schema.appBuilderSessions)
      .set({
        eventSequence: sql`${schema.appBuilderSessions.eventSequence} + 1`,
        eventCount: sql`${schema.appBuilderSessions.eventCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(schema.appBuilderSessions.id, normalizeObjectId(id)))
      .returning({ eventSequence: schema.appBuilderSessions.eventSequence });
    return row?.eventSequence ?? null;
  }

  async countWithAiFeatures(): Promise<number> {
    const [row] = await this.q
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.appBuilderSessions)
      .where(
        and(
          eq(schema.appBuilderSessions.hasAiFeatures, true),
          isNull(schema.appBuilderSessions.deletedAt),
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
        ownerId: schema.appBuilderSessions.ownerId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.appBuilderSessions)
      .where(
        and(
          inArray(schema.appBuilderSessions.ownerId, ids),
          eq(schema.appBuilderSessions.hasAiFeatures, true),
          isNull(schema.appBuilderSessions.deletedAt),
        ),
      )
      .groupBy(schema.appBuilderSessions.ownerId);
    for (const row of rows) out.set(row.ownerId, Number(row.count ?? 0));
    return out;
  }

  async listWithAiFeaturesByOwner(ownerId: string): Promise<AppBuilderSessionRecord[]> {
    if (!isObjectId(ownerId)) return [];
    const rows = await this.q
      .select()
      .from(schema.appBuilderSessions)
      .where(
        and(
          eq(schema.appBuilderSessions.ownerId, normalizeObjectId(ownerId)),
          eq(schema.appBuilderSessions.hasAiFeatures, true),
          isNull(schema.appBuilderSessions.deletedAt),
        ),
      )
      .orderBy(desc(schema.appBuilderSessions.updatedAt));
    return rows.map(PgAppBuilderSessionStore.toRecord);
  }
}
