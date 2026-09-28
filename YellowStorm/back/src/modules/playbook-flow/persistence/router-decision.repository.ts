import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isForeignKeyViolation, isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';

const d = schema.playbookRouterDecisions;

export type RouterDecisionRecord = typeof d.$inferSelect;

export interface NewRouterDecision {
  executionId: string;
  routerNodeId: string;
  iteration: number;
  label: string;
  decidedAt?: Date;
}

/** PostgreSQL playbook.router_decisions repository (roadmap P5): the branch each router took, per iteration. */
@Injectable()
export class RouterDecisionRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /** Records a decision; null when the run no longer exists (the foreign key refuses it). */
  async create(input: NewRouterDecision): Promise<RouterDecisionRecord | null> {
    if (!isObjectId(input.executionId)) return null;
    try {
      const [row] = await this.q
        .insert(d)
        .values({
          id: newObjectId(),
          executionId: normalizeObjectId(input.executionId),
          routerNodeId: stripNul(input.routerNodeId),
          iteration: Number.isFinite(input.iteration) ? Math.trunc(input.iteration) : 0,
          label: stripNul(input.label),
          decidedAt: input.decidedAt ?? new Date(),
        })
        .returning();
      return row;
    } catch (err) {
      if (isForeignKeyViolation(err)) return null;
      throw err;
    }
  }

  /** The run's decisions in the order they were taken. */
  async listForExecution(executionId: string): Promise<RouterDecisionRecord[]> {
    if (!isObjectId(executionId)) return [];
    return this.q.select().from(d).where(eq(d.executionId, normalizeObjectId(executionId))).orderBy(asc(d.decidedAt), asc(d.id));
  }
}
