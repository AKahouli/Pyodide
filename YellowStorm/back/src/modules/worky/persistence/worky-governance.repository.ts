import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { WorkyGovernancePolicyRecord } from '../worky.types';

const g = schema.workyGovernancePolicies;

export interface WorkyGovernancePolicyInput {
  workspaceId: string;
  defaultLevel: string;
  categories: { category: string; level: string }[];
  allowStreamOwnerOverride: boolean;
  maxOwnerRelaxLevel: string;
}

/** PostgreSQL worky.governance_policies repository (roadmap P7). */
@Injectable()
export class WorkyGovernanceRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async findWorkspacePolicy(workspaceId: string): Promise<WorkyGovernancePolicyRecord | null> {
    if (!isObjectId(workspaceId)) return null;
    const [row] = await this.q
      .select()
      .from(g)
      .where(and(eq(g.workspaceId, normalizeObjectId(workspaceId)), eq(g.scope, 'workspace')))
      .limit(1);
    return row ?? null;
  }

  /** Creates the workspace's policy or overwrites the one it has. */
  async upsertWorkspacePolicy(input: WorkyGovernancePolicyInput): Promise<WorkyGovernancePolicyRecord> {
    const fields = {
      defaultLevel: input.defaultLevel,
      categories: stripNul(input.categories),
      allowStreamOwnerOverride: input.allowStreamOwnerOverride,
      maxOwnerRelaxLevel: input.maxOwnerRelaxLevel,
    };
    const [row] = await this.q
      .insert(g)
      .values({ id: newObjectId(), workspaceId: normalizeObjectId(input.workspaceId), scope: 'workspace', ...fields })
      .onConflictDoUpdate({ target: [g.workspaceId, g.scope], set: { ...fields, updatedAt: new Date() } })
      .returning();
    return row;
  }
}
