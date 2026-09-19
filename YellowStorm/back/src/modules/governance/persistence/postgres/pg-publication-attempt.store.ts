import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { newObjectId } from '@common/postgres/object-id';
import { resolveQueryable } from '@common/postgres/transaction';
import { PUBLICATION_ATTEMPT_STORE, type GovernancePublicationAttemptCreateInput, type PublicationAttemptStore } from '../publication-attempt-store';
import type { GovernancePublicationAttemptRecord } from '../governance-records';

const ATTEMPTS = schema.governancePublicationAttempts;
type AttemptRow = typeof ATTEMPTS.$inferSelect;

export function publicationAttemptRowToRecord(row: AttemptRow): GovernancePublicationAttemptRecord {
  return {
    id: row.id,
    programId: row.programId,
    scopeId: row.scopeId,
    deploymentId: row.deploymentId,
    revisionId: row.revisionId ?? undefined,
    triggeredByUserId: row.triggeredByUserId,
    triggeredByEmail: row.triggeredByEmail,
    requestedChannels: row.requestedChannels,
    allowPartial: row.allowPartial,
    comment: row.comment ?? undefined,
    status: row.status as GovernancePublicationAttemptRecord['status'],
    readinessSnapshot: row.readinessSnapshot ?? {},
    errorCode: row.errorCode ?? undefined,
    errorMessage: row.errorMessage ?? undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

@Injectable()
export class PgPublicationAttemptStore implements PublicationAttemptStore {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q() {
    return resolveQueryable(this.db);
  }

  async insert(input: GovernancePublicationAttemptCreateInput): Promise<GovernancePublicationAttemptRecord> {
    const [row] = await this.q
      .insert(ATTEMPTS)
      .values({
        id: newObjectId(),
        programId: input.programId,
        scopeId: input.scopeId,
        deploymentId: input.deploymentId,
        revisionId: input.revisionId ?? null,
        triggeredByUserId: input.triggeredByUserId,
        triggeredByEmail: input.triggeredByEmail,
        requestedChannels: input.requestedChannels,
        allowPartial: input.allowPartial,
        comment: input.comment ?? null,
        status: input.status,
        readinessSnapshot: input.readinessSnapshot ?? {},
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
      })
      .returning();
    return publicationAttemptRowToRecord(row);
  }

  async deleteByProgramAndScope(programId: string, scopeId: string): Promise<void> {
    await this.q.delete(ATTEMPTS).where(and(eq(ATTEMPTS.programId, programId), eq(ATTEMPTS.scopeId, scopeId)));
  }
}
