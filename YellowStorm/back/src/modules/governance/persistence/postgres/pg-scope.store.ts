import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable, withTransaction } from '@common/postgres/transaction';
import { SCOPE_STORE, type GovernanceScopeCreateInput, type GovernanceScopePatch, type ScopeStore } from '../scope-store';
import type { GovernanceScopeRecord } from '../governance-records';

const SCOPES = schema.governanceScopes;
const SCOPE_AGENTS = schema.governanceScopeAgents;
const AUDIENCE_USERS = schema.governanceScopeAudienceUsers;
const AUDIENCE_GROUPS = schema.governanceScopeAudienceGroups;
type ScopeRow = typeof SCOPES.$inferSelect;

type Audience = GovernanceScopeRecord['audience'];
type Knowledge = GovernanceScopeRecord['knowledge'];

function scopeRowToRecord(row: ScopeRow, agentIds: string[], audience: Audience): GovernanceScopeRecord {
  return {
    id: row.id,
    programId: row.programId,
    parentScopeId: row.parentScopeId ?? undefined,
    name: row.name,
    type: row.type as GovernanceScopeRecord['type'],
    status: row.status as GovernanceScopeRecord['status'],
    agentIds,
    audience,
    knowledge: {
      sourceMode: row.knowledgeSourceMode as Knowledge['sourceMode'],
      webSourcesEnabled: row.knowledgeWebSourcesEnabled,
      webAllowedDomains: row.knowledgeWebAllowedDomains,
      webBlockedDomains: row.knowledgeWebBlockedDomains,
    },
    metadata: row.metadata ?? {},
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PgScopeStore implements ScopeStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  /** Audience/agent child ids are stored in dedicated rows; the scope record exposes them as arrays. */
  private async hydrate(rows: ScopeRow[]): Promise<GovernanceScopeRecord[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const [agentRows, userRows, groupRows] = await Promise.all([
      this.q.select().from(SCOPE_AGENTS).where(inArray(SCOPE_AGENTS.scopeId, ids)),
      this.q.select().from(AUDIENCE_USERS).where(inArray(AUDIENCE_USERS.scopeId, ids)),
      this.q.select().from(AUDIENCE_GROUPS).where(inArray(AUDIENCE_GROUPS.scopeId, ids)),
    ]);
    const agentsByScope = new Map<string, string[]>();
    for (const row of agentRows) agentsByScope.set(row.scopeId, [...(agentsByScope.get(row.scopeId) ?? []), row.agentId]);
    const usersByScope = new Map<string, string[]>();
    for (const row of userRows) usersByScope.set(row.scopeId, [...(usersByScope.get(row.scopeId) ?? []), row.userId]);
    const groupsByScope = new Map<string, string[]>();
    for (const row of groupRows) groupsByScope.set(row.scopeId, [...(groupsByScope.get(row.scopeId) ?? []), row.groupId]);
    return rows.map((row) =>
      scopeRowToRecord(row, agentsByScope.get(row.id) ?? [], {
        mode: row.audienceMode as Audience['mode'],
        userIds: usersByScope.get(row.id) ?? [],
        groupIds: groupsByScope.get(row.id) ?? [],
      }),
    );
  }

  async insert(input: GovernanceScopeCreateInput): Promise<GovernanceScopeRecord> {
    const id = newObjectId();
    const audience = input.audience ?? { mode: 'restricted' as const, userIds: [], groupIds: [] };
    const record = await withTransaction(this.db, async (tx) => {
      const [row] = await tx
        .insert(SCOPES)
        .values({
          id,
          programId: input.programId,
          parentScopeId: input.parentScopeId ?? null,
          name: input.name,
          type: input.type ?? 'custom',
          status: input.status ?? 'active',
          audienceMode: audience.mode,
          knowledgeSourceMode: input.knowledge?.sourceMode ?? 'llm_only',
          knowledgeWebSourcesEnabled: input.knowledge?.webSourcesEnabled ?? false,
          knowledgeWebAllowedDomains: input.knowledge?.webAllowedDomains ?? [],
          knowledgeWebBlockedDomains: input.knowledge?.webBlockedDomains ?? [],
          metadata: input.metadata ?? {},
        })
        .returning();
      if (input.agentIds?.length) await tx.insert(SCOPE_AGENTS).values(input.agentIds.map((agentId) => ({ scopeId: id, agentId })));
      if (audience.userIds.length) await tx.insert(AUDIENCE_USERS).values(audience.userIds.map((userId) => ({ scopeId: id, userId })));
      if (audience.groupIds.length) await tx.insert(AUDIENCE_GROUPS).values(audience.groupIds.map((groupId) => ({ scopeId: id, groupId })));
      return scopeRowToRecord(row, input.agentIds ?? [], audience);
    });
    return record;
  }

  async findById(scopeId: string): Promise<GovernanceScopeRecord | null> {
    const rows = await this.q.select().from(SCOPES).where(eq(SCOPES.id, scopeId)).limit(1);
    return rows[0] ? (await this.hydrate(rows))[0] : null;
  }

  async findByProgramAndId(programId: string, scopeId: string): Promise<GovernanceScopeRecord | null> {
    const rows = await this.q.select().from(SCOPES).where(and(eq(SCOPES.id, scopeId), eq(SCOPES.programId, programId))).limit(1);
    return rows[0] ? (await this.hydrate(rows))[0] : null;
  }

  async listByProgram(programId: string, scopeIds: string[] | '*'): Promise<GovernanceScopeRecord[]> {
    const rows = await this.q
      .select()
      .from(SCOPES)
      .where(
        scopeIds === '*'
          ? eq(SCOPES.programId, programId)
          : and(eq(SCOPES.programId, programId), inArray(SCOPES.id, scopeIds)),
      )
      .orderBy(asc(SCOPES.createdAt));
    return this.hydrate(rows);
  }


  async listActive(): Promise<GovernanceScopeRecord[]> {
    const rows = await this.q.select().from(SCOPES).where(eq(SCOPES.status, 'active')).orderBy(asc(SCOPES.createdAt));
    return this.hydrate(rows);
  }

  async update(scopeId: string, patch: GovernanceScopePatch): Promise<GovernanceScopeRecord | null> {
    const record = await withTransaction(this.db, async (tx) => {
      const [row] = await tx
        .update(SCOPES)
        .set({
          ...(patch.name !== undefined ? { name: patch.name } : {}),
          ...(patch.parentScopeId !== undefined ? { parentScopeId: patch.parentScopeId } : {}),
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.knowledge !== undefined
            ? {
                knowledgeSourceMode: patch.knowledge.sourceMode,
                knowledgeWebSourcesEnabled: patch.knowledge.webSourcesEnabled,
                knowledgeWebAllowedDomains: patch.knowledge.webAllowedDomains,
                knowledgeWebBlockedDomains: patch.knowledge.webBlockedDomains,
              }
            : {}),
          ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
          ...(patch.audience !== undefined ? { audienceMode: patch.audience.mode } : {}),
          updatedAt: new Date(),
        })
        .where(eq(SCOPES.id, scopeId))
        .returning();
      if (!row) return null;
      if (patch.agentIds !== undefined) {
        await tx.delete(SCOPE_AGENTS).where(eq(SCOPE_AGENTS.scopeId, scopeId));
        if (patch.agentIds.length) await tx.insert(SCOPE_AGENTS).values(patch.agentIds.map((agentId) => ({ scopeId, agentId })));
      }
      if (patch.audience !== undefined) {
        await tx.delete(AUDIENCE_USERS).where(eq(AUDIENCE_USERS.scopeId, scopeId));
        await tx.delete(AUDIENCE_GROUPS).where(eq(AUDIENCE_GROUPS.scopeId, scopeId));
        if (patch.audience.userIds.length) await tx.insert(AUDIENCE_USERS).values(patch.audience.userIds.map((userId) => ({ scopeId, userId })));
        if (patch.audience.groupIds.length) await tx.insert(AUDIENCE_GROUPS).values(patch.audience.groupIds.map((groupId) => ({ scopeId, groupId })));
      }
      return row;
    });
    if (!record) return null;
    return (await this.hydrate([record]))[0];
  }

  async setMetadataReviewStatus(scopeId: string, status: string): Promise<void> {
    await this.q
      .update(SCOPES)
      .set({
        metadata: sql`jsonb_set(coalesce(${SCOPES.metadata}, '{}'::jsonb), '{review,status}', to_jsonb(${status}::text), true)`,
        updatedAt: new Date(),
      })
      .where(eq(SCOPES.id, scopeId));
  }

  async countByProgram(programId: string): Promise<number> {
    const rows = await this.q.select({ count: sql<number>`count(*)::int` }).from(SCOPES).where(eq(SCOPES.programId, programId));
    return rows[0]?.count ?? 0;
  }

  async listHierarchy(programId: string): Promise<Array<{ id: string; parentScopeId: string | null }>> {
    return this.q.select({ id: SCOPES.id, parentScopeId: SCOPES.parentScopeId }).from(SCOPES).where(eq(SCOPES.programId, programId));
  }

  async deleteByIdsAndProgram(scopeIds: string[], programId: string): Promise<void> {
    if (scopeIds.length === 0) return;
    await this.q.delete(SCOPES).where(and(eq(SCOPES.programId, programId), inArray(SCOPES.id, scopeIds)));
  }

  async deleteByIdAndProgram(scopeId: string, programId: string): Promise<void> {
    await this.q.delete(SCOPES).where(and(eq(SCOPES.id, scopeId), eq(SCOPES.programId, programId)));
  }
}
