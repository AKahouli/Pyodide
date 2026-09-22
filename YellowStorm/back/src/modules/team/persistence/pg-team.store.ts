import { Inject } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { escapeLike } from '@common/postgres/like';
import { countOver, pageOf } from '@common/postgres/pagination';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { withTransaction, resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import {
  TEAM_AUTO_BUILDER_STORE,
  TEAM_SHARE_STORE,
  TEAM_STORE,
  type NewTeamRow,
  type TeamAutoBuilderConfigRow,
  type TeamAutoBuilderStore,
  type TeamListQuery,
  type TeamRow,
  type TeamShareRow,
  type TeamShareStore,
  type TeamStore,
} from './team.store';

type TeamT = typeof schema.teams.$inferSelect;
type MemberT = typeof schema.teamMembers.$inferSelect;
type ShareT = typeof schema.sharedTeams.$inferSelect;

async function hydrateMembers(q: PgQueryable<typeof schema>, teamIds: string[]): Promise<Map<string, TeamRow['members']>> {
  const map = new Map<string, TeamRow['members']>();
  if (teamIds.length === 0) return map;
  const rows = await q
    .select()
    .from(schema.teamMembers)
    .where(inArray(schema.teamMembers.teamId, teamIds))
    .orderBy(asc(schema.teamMembers.position));
  for (const r of rows) {
    const list = map.get(r.teamId) ?? [];
    list.push({
      agentId: r.agentId,
      parentAgentId: r.parentAgentId ?? null,
      order: r.order,
      positionX: r.positionX,
      positionY: r.positionY,
    });
    map.set(r.teamId, list);
  }
  return map;
}

function teamToRow(r: TeamT, members: TeamRow['members']): TeamRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    isActive: r.isActive,
    createdBy: r.createdBy,
    members,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export class PgTeamStore implements TeamStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private async replaceMembers(tx: PgQueryable<typeof schema>, teamId: string, members: NewTeamRow['members']): Promise<void> {
    await tx.delete(schema.teamMembers).where(eq(schema.teamMembers.teamId, teamId));
    if (members.length > 0) {
      await tx.insert(schema.teamMembers).values(
        members.map((m, position) => ({
          teamId,
          agentId: m.agentId,
          parentAgentId: m.parentAgentId ?? null,
          order: m.order,
          positionX: m.positionX,
          positionY: m.positionY,
          position,
        })),
      );
    }
  }

  async findByOwnerAndName(name: string, createdBy: string): Promise<TeamRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.teams)
      .where(and(eq(schema.teams.name, name), eq(schema.teams.createdBy, createdBy)))
      .limit(1);
    if (!row) return null;
    const members = await hydrateMembers(this.q, [row.id]);
    return teamToRow(row, members.get(row.id) ?? []);
  }

  async findNameClash(name: string, createdBy: string, excludeId: string): Promise<TeamRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.teams)
      .where(and(
        eq(schema.teams.name, name),
        eq(schema.teams.createdBy, createdBy),
        sql`${schema.teams.id} <> ${excludeId}`,
      ))
      .limit(1);
    if (!row) return null;
    const members = await hydrateMembers(this.q, [row.id]);
    return teamToRow(row, members.get(row.id) ?? []);
  }

  async create(row: NewTeamRow): Promise<TeamRow> {
    return withTransaction(this.db, async (tx) => {
      const [inserted] = await tx
        .insert(schema.teams)
        .values({
          id: newObjectId(),
          name: row.name,
          description: row.description,
          isActive: row.isActive,
          createdBy: row.createdBy,
        })
        .returning();
      await this.replaceMembers(tx, inserted.id, row.members);
      const members = await hydrateMembers(tx, [inserted.id]);
      return teamToRow(inserted, members.get(inserted.id) ?? []);
    });
  }

  async list(query: TeamListQuery): Promise<{ rows: TeamRow[]; total: number }> {
    const conditions: SQL[] = [eq(schema.teams.createdBy, query.createdBy)];
    if (query.search) conditions.push(ilike(schema.teams.name, `%${escapeLike(query.search)}%`));
    if (query.isActive !== undefined) conditions.push(eq(schema.teams.isActive, query.isActive));
    const filter = and(...conditions);
    const offset = (query.page - 1) * query.limit;

    // pageOf: total via COUNT(*) OVER() so pagination is one round trip (plan 4.3),
    // with an exact COUNT fallback when the requested page is past the end (R-12).
    const rows = await this.q
      .select({ team: schema.teams, total: countOver() })
      .from(schema.teams)
      .where(filter)
      .orderBy(desc(schema.teams.createdAt))
      .offset(offset)
      .limit(query.limit);

    const { items, total } = await pageOf(
      rows,
      offset > 0
        ? {
            offset,
            count: async () =>
              (
                await this.q
                  .select({ n: sql<number>`count(*)::int` })
                  .from(schema.teams)
                  .where(filter)
              )[0]?.n ?? 0,
          }
        : undefined,
    );
    const teams = items.map((i) => i.team);
    const members = await hydrateMembers(this.q, teams.map((t) => t.id));
    return { rows: teams.map((t) => teamToRow(t, members.get(t.id) ?? [])), total };
  }

  async findActiveByOwner(userId: string): Promise<TeamRow[]> {
    const rows = await this.q
      .select()
      .from(schema.teams)
      .where(and(eq(schema.teams.createdBy, userId), eq(schema.teams.isActive, true)))
      .orderBy(desc(schema.teams.createdAt));
    const members = await hydrateMembers(this.q, rows.map((r) => r.id));
    return rows.map((r) => teamToRow(r, members.get(r.id) ?? []));
  }

  async findById(id: string): Promise<TeamRow | null> {
    const [row] = await this.q.select().from(schema.teams).where(eq(schema.teams.id, id)).limit(1);
    if (!row) return null;
    const members = await hydrateMembers(this.q, [row.id]);
    return teamToRow(row, members.get(row.id) ?? []);
  }

  async update(id: string, patch: Partial<Omit<NewTeamRow, 'createdBy'>>): Promise<TeamRow | null> {
    return withTransaction(this.db, async (tx) => {
      const { members, ...columns } = patch;
      const [row] = await tx
        .update(schema.teams)
        .set({
          ...columns,
          updatedAt: new Date(),
        } as unknown as Partial<typeof schema.teams.$inferInsert>)
        .where(eq(schema.teams.id, id))
        .returning();
      if (!row) return null;
      if (members) await this.replaceMembers(tx, id, members);
      const fresh = await hydrateMembers(tx, [id]);
      return teamToRow(row, fresh.get(id) ?? []);
    });
  }

  async delete(id: string): Promise<TeamRow | null> {
    const [row] = await this.q.delete(schema.teams).where(eq(schema.teams.id, id)).returning();
    if (!row) return null;
    return teamToRow(row, []);
  }

  async findByIdsActiveForOwner(ids: string[], createdBy: string): Promise<TeamRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.q
      .select()
      .from(schema.teams)
      .where(and(
        inArray(schema.teams.id, ids),
        eq(schema.teams.createdBy, createdBy),
        eq(schema.teams.isActive, true),
      ));
    const members = await hydrateMembers(this.q, rows.map((r) => r.id));
    return rows.map((r) => teamToRow(r, members.get(r.id) ?? []));
  }

  async findByIds(ids: string[]): Promise<TeamRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.q.select().from(schema.teams).where(inArray(schema.teams.id, ids));
    const members = await hydrateMembers(this.q, rows.map((r) => r.id));
    return rows.map((r) => teamToRow(r, members.get(r.id) ?? []));
  }
}

export class PgTeamShareStore implements TeamShareStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private toRow = (r: ShareT): TeamShareRow => ({
    id: r.id,
    teamId: r.teamId,
    sharedBy: r.sharedBy,
    sharedWith: r.sharedWith,
    permission: r.permission,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });

  async upsertMany(teamId: string, sharedBy: string, sharedWithIds: string[], permission: string): Promise<TeamShareRow[]> {
    if (sharedWithIds.length === 0) return [];
    const rows = await this.q
      .insert(schema.sharedTeams)
      .values(sharedWithIds.map((sharedWith) => ({ id: newObjectId(), teamId, sharedBy, sharedWith, permission })))
      .onConflictDoUpdate({
        target: [schema.sharedTeams.teamId, schema.sharedTeams.sharedWith],
        set: { permission, sharedBy, updatedAt: new Date() },
      })
      .returning();
    return rows.map(this.toRow);
  }

  async findByTeam(teamId: string): Promise<TeamShareRow[]> {
    const rows = await this.q
      .select()
      .from(schema.sharedTeams)
      .where(eq(schema.sharedTeams.teamId, teamId))
      .orderBy(desc(schema.sharedTeams.createdAt));
    return rows.map(this.toRow);
  }

  async find(teamId: string, sharedWith: string): Promise<TeamShareRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.sharedTeams)
      .where(and(eq(schema.sharedTeams.teamId, teamId), eq(schema.sharedTeams.sharedWith, sharedWith)))
      .limit(1);
    return row ? this.toRow(row) : null;
  }

  async findByIdAndTeam(shareId: string, teamId: string): Promise<TeamShareRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.sharedTeams)
      .where(and(eq(schema.sharedTeams.id, shareId), eq(schema.sharedTeams.teamId, teamId)))
      .limit(1);
    return row ? this.toRow(row) : null;
  }

  async updatePermission(shareId: string, teamId: string, permission: string): Promise<TeamShareRow | null> {
    const [row] = await this.q
      .update(schema.sharedTeams)
      .set({ permission, updatedAt: new Date() })
      .where(and(eq(schema.sharedTeams.id, shareId), eq(schema.sharedTeams.teamId, teamId)))
      .returning();
    return row ? this.toRow(row) : null;
  }

  async deleteByIdAndTeam(shareId: string, teamId: string): Promise<TeamShareRow | null> {
    const [row] = await this.q
      .delete(schema.sharedTeams)
      .where(and(eq(schema.sharedTeams.id, shareId), eq(schema.sharedTeams.teamId, teamId)))
      .returning();
    return row ? this.toRow(row) : null;
  }

  async deleteForUser(teamId: string, userId: string): Promise<TeamShareRow | null> {
    const [row] = await this.q
      .delete(schema.sharedTeams)
      .where(and(eq(schema.sharedTeams.teamId, teamId), eq(schema.sharedTeams.sharedWith, userId)))
      .returning();
    return row ? this.toRow(row) : null;
  }

  async deleteAllForTeam(teamId: string): Promise<void> {
    // Shares cascade on team delete; kept for the explicit revoke path.
    await this.q.delete(schema.sharedTeams).where(eq(schema.sharedTeams.teamId, teamId));
  }

  async listSharedWithUser(userId: string): Promise<TeamShareRow[]> {
    const rows = await this.q
      .select()
      .from(schema.sharedTeams)
      .where(eq(schema.sharedTeams.sharedWith, userId));
    return rows.map(this.toRow);
  }
}

export class PgTeamAutoBuilderStore implements TeamAutoBuilderStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async find(): Promise<TeamAutoBuilderConfigRow | null> {
    const [row] = await this.q.select().from(schema.teamAutoBuilderConfig).limit(1);
    return row
      ? { id: row.id, modelId: row.modelId, systemPrompt: row.systemPrompt, temperature: row.temperature, isEnabled: row.isEnabled, updatedAt: row.updatedAt }
      : null;
  }

  async upsert(config: { modelId: string; systemPrompt: string; temperature: number; isEnabled: boolean }): Promise<TeamAutoBuilderConfigRow> {
    const [row] = await this.q
      .insert(schema.teamAutoBuilderConfig)
      .values({ id: newObjectId(), singleton: true, ...config })
      .onConflictDoUpdate({
        target: schema.teamAutoBuilderConfig.singleton,
        set: {
          modelId: config.modelId,
          systemPrompt: config.systemPrompt,
          temperature: config.temperature,
          isEnabled: config.isEnabled,
          updatedAt: new Date(),
        },
      })
      .returning();
    return { id: row.id, modelId: row.modelId, systemPrompt: row.systemPrompt, temperature: row.temperature, isEnabled: row.isEnabled, updatedAt: row.updatedAt };
  }
}
