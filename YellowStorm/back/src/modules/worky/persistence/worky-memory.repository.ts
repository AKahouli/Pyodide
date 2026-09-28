import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul, withTransaction } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { WorkyMemoryEntryRecord, WorkyMemoryProposalRecord } from '../worky.types';

const p = schema.workyMemoryProposals;
const e = schema.workyMemoryEntries;

export interface NewWorkyMemoryProposal {
  ownerUserId: string;
  sourceStreamId: string | null;
  category: string;
  title: string;
  content: string;
}

/** PostgreSQL worky.memory_proposals and worky.memory_entries repository (roadmap P7). */
@Injectable()
export class WorkyMemoryRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async createProposal(input: NewWorkyMemoryProposal): Promise<WorkyMemoryProposalRecord> {
    const [row] = await this.q
      .insert(p)
      .values({
        id: newObjectId(),
        ownerUserId: normalizeObjectId(input.ownerUserId),
        sourceStreamId: input.sourceStreamId ? normalizeObjectId(input.sourceStreamId) : null,
        category: input.category,
        title: stripNul(input.title),
        content: stripNul(input.content),
      })
      .returning();
    return row;
  }

  async findProposal(id: string): Promise<WorkyMemoryProposalRecord | null> {
    if (!isObjectId(id)) return null;
    const [row] = await this.q.select().from(p).where(eq(p.id, normalizeObjectId(id))).limit(1);
    return row ?? null;
  }

  async findEntryByProposal(proposalId: string): Promise<WorkyMemoryEntryRecord | null> {
    if (!isObjectId(proposalId)) return null;
    const [row] = await this.q.select().from(e).where(eq(e.sourceProposalId, normalizeObjectId(proposalId))).limit(1);
    return row ?? null;
  }

  /**
   * Confirms a pending proposal and writes its durable entry, in one transaction. Null when the
   * proposal is not pending any more (someone decided it first): nothing is written.
   */
  async confirm(proposalId: string): Promise<{ proposal: WorkyMemoryProposalRecord; entry: WorkyMemoryEntryRecord } | null> {
    if (!isObjectId(proposalId)) return null;
    return withTransaction(this.db, async () => {
      const [proposal] = await this.q
        .update(p)
        .set({ status: 'confirmed', decidedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(p.id, normalizeObjectId(proposalId)), eq(p.status, 'pending')))
        .returning();
      if (!proposal) return null;
      const [entry] = await this.q
        .insert(e)
        .values({
          id: newObjectId(),
          ownerUserId: proposal.ownerUserId,
          sourceProposalId: proposal.id,
          sourceStreamId: proposal.sourceStreamId,
          category: proposal.category,
          title: proposal.title,
          content: proposal.content,
        })
        .returning();
      return { proposal, entry };
    });
  }

  /** Rejects a pending proposal. Null when it is not pending any more. */
  async reject(proposalId: string): Promise<WorkyMemoryProposalRecord | null> {
    if (!isObjectId(proposalId)) return null;
    const [row] = await this.q
      .update(p)
      .set({ status: 'rejected', decidedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(p.id, normalizeObjectId(proposalId)), eq(p.status, 'pending')))
      .returning();
    return row ?? null;
  }

  async listProposals(ownerUserId: string, status: string | undefined, limit: number): Promise<WorkyMemoryProposalRecord[]> {
    if (!isObjectId(ownerUserId)) return [];
    return this.q
      .select()
      .from(p)
      .where(and(eq(p.ownerUserId, normalizeObjectId(ownerUserId)), status ? eq(p.status, status) : undefined))
      .orderBy(desc(p.createdAt), desc(p.id))
      .limit(limit);
  }

  async listEntries(ownerUserId: string, limit: number): Promise<WorkyMemoryEntryRecord[]> {
    if (!isObjectId(ownerUserId)) return [];
    return this.q
      .select()
      .from(e)
      .where(eq(e.ownerUserId, normalizeObjectId(ownerUserId)))
      .orderBy(desc(e.createdAt), desc(e.id))
      .limit(limit);
  }
}
