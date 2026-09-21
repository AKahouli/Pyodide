import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { eq, inArray, sql } from 'drizzle-orm';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { isObjectId, normalizeObjectId } from '@common/postgres/object-id';
import type { GovernanceGroupLookupPort, GovernanceGroupSummary } from '../group-lookup.port';

/** PostgreSQL GovernanceGroupLookupPort over identity.user_groups (remediation plan step 1.4). */
@Injectable()
export class PgGroupLookupAdapter implements GovernanceGroupLookupPort {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  async summariesByIds(ids: string[]): Promise<Map<string, GovernanceGroupSummary>> {
    const normalized = [...new Set(ids)].filter(isObjectId).map(normalizeObjectId);
    const summaries = new Map<string, GovernanceGroupSummary>();
    if (normalized.length === 0) return summaries;

    const rows = await this.db
      .select({
        id: schema.identityUserGroups.id,
        name: schema.identityUserGroups.name,
        memberCount: sql<number>`count(${schema.identityUserGroupMembers.userId})::int`,
      })
      .from(schema.identityUserGroups)
      .leftJoin(
        schema.identityUserGroupMembers,
        eq(schema.identityUserGroupMembers.groupId, schema.identityUserGroups.id),
      )
      .where(inArray(schema.identityUserGroups.id, normalized))
      .groupBy(schema.identityUserGroups.id, schema.identityUserGroups.name);

    for (const row of rows) {
      summaries.set(row.id, { id: row.id, name: row.name ?? '', memberCount: Number(row.memberCount) });
    }
    return summaries;
  }
}
