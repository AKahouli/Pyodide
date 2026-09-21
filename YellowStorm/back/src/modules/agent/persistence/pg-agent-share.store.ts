import { Inject } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import { newObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import * as schema from '@modules/postgres/schema';
import { AGENT_SHARE_STORE, type AgentShareRow, type AgentShareStore } from './agent-share.store';

type Row = typeof schema.sharedAgents.$inferSelect;

function toRow(r: Row): AgentShareRow {
  return {
    id: r.id,
    agentId: r.agentId,
    sharedBy: r.sharedBy,
    sharedWith: r.sharedWith,
    permission: r.permission,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** PostgreSQL public.shared_agents implementation of AgentShareStore (plan 4.1). */
export class PgAgentShareStore implements AgentShareStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async upsertMany(agentId: string, sharedBy: string, sharedWithIds: string[], permission: string): Promise<AgentShareRow[]> {
    if (sharedWithIds.length === 0) return [];
    const rows = await this.q
      .insert(schema.sharedAgents)
      .values(sharedWithIds.map((sharedWith) => ({ id: newObjectId(), agentId, sharedBy, sharedWith, permission })))
      .onConflictDoUpdate({
        target: [schema.sharedAgents.agentId, schema.sharedAgents.sharedWith],
        set: { permission, sharedBy, updatedAt: new Date() },
      })
      .returning();
    return rows.map(toRow);
  }

  async findByAgent(agentId: string): Promise<AgentShareRow[]> {
    const rows = await this.q
      .select()
      .from(schema.sharedAgents)
      .where(eq(schema.sharedAgents.agentId, agentId))
      .orderBy(desc(schema.sharedAgents.createdAt));
    return rows.map(toRow);
  }

  async find(agentId: string, sharedWith: string): Promise<AgentShareRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.sharedAgents)
      .where(and(eq(schema.sharedAgents.agentId, agentId), eq(schema.sharedAgents.sharedWith, sharedWith)))
      .limit(1);
    return row ? toRow(row) : null;
  }

  async findById(shareId: string): Promise<AgentShareRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.sharedAgents)
      .where(eq(schema.sharedAgents.id, shareId))
      .limit(1);
    return row ? toRow(row) : null;
  }

  async findByIdAndAgent(shareId: string, agentId: string): Promise<AgentShareRow | null> {
    const [row] = await this.q
      .select()
      .from(schema.sharedAgents)
      .where(and(eq(schema.sharedAgents.id, shareId), eq(schema.sharedAgents.agentId, agentId)))
      .limit(1);
    return row ? toRow(row) : null;
  }

  async updatePermission(shareId: string, agentId: string, permission: string): Promise<AgentShareRow | null> {
    const [row] = await this.q
      .update(schema.sharedAgents)
      .set({ permission, updatedAt: new Date() })
      .where(and(eq(schema.sharedAgents.id, shareId), eq(schema.sharedAgents.agentId, agentId)))
      .returning();
    return row ? toRow(row) : null;
  }

  async deleteByIdAndAgent(shareId: string, agentId: string): Promise<AgentShareRow | null> {
    const [row] = await this.q
      .delete(schema.sharedAgents)
      .where(and(eq(schema.sharedAgents.id, shareId), eq(schema.sharedAgents.agentId, agentId)))
      .returning();
    return row ? toRow(row) : null;
  }

  async deleteForUser(agentId: string, userId: string): Promise<AgentShareRow | null> {
    const [row] = await this.q
      .delete(schema.sharedAgents)
      .where(and(eq(schema.sharedAgents.agentId, agentId), eq(schema.sharedAgents.sharedWith, userId)))
      .returning();
    return row ? toRow(row) : null;
  }

  async listSharedWithUser(userId: string): Promise<AgentShareRow[]> {
    const rows = await this.q
      .select()
      .from(schema.sharedAgents)
      .where(eq(schema.sharedAgents.sharedWith, userId));
    return rows.map(toRow);
  }
}
