import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { PlaybookAssistantOperationKey } from './assistant-operation.repository';

const v = schema.playbookAssistantRevisions;

export type PlaybookAssistantRevisionRecord = typeof v.$inferSelect;

export interface NewPlaybookAssistantRevision extends PlaybookAssistantOperationKey {
  definitionRevision: number;
  definition: Record<string, unknown>;
  expiresAt: Date;
}

/**
 * PostgreSQL playbook.assistant_revisions repository (roadmap P5): the Playbook definition captured
 * before an assistant operation was committed, so the commit can be reverted. One row per operation,
 * TTL-swept on `expires_at` and invisible here once expired.
 */
@Injectable()
export class PlaybookAssistantRevisionRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /**
   * Captures the snapshot once per operation: a retried commit only extends its retention, while an
   * expired snapshot (the TTL sweep has not run yet) is replaced as if it were gone.
   */
  async captureOnce(input: NewPlaybookAssistantRevision): Promise<void> {
    const expired = sql`${v.expiresAt} <= now()`;
    const fresh = (column: string, current: SQLWrapper): SQL =>
      sql`CASE WHEN ${expired} THEN excluded.${sql.identifier(column)} ELSE ${current} END`;
    await this.q
      .insert(v)
      .values({
        id: newObjectId(),
        operationId: input.operationId,
        playbookId: input.playbookId,
        ownerId: input.ownerId,
        definitionRevision: input.definitionRevision,
        definition: stripNul(input.definition),
        expiresAt: input.expiresAt,
      })
      .onConflictDoUpdate({
        target: v.operationId,
        set: {
          playbookId: fresh('playbook_id', v.playbookId),
          ownerId: fresh('owner_id', v.ownerId),
          definitionRevision: fresh('definition_revision', v.definitionRevision),
          definition: fresh('definition', v.definition),
          createdAt: fresh('created_at', v.createdAt),
          expiresAt: sql`excluded.expires_at`,
          updatedAt: new Date(),
        },
      });
  }

  async find(key: PlaybookAssistantOperationKey): Promise<PlaybookAssistantRevisionRecord | null> {
    const [row] = await this.q
      .select()
      .from(v)
      .where(and(eq(v.operationId, key.operationId), eq(v.playbookId, key.playbookId), eq(v.ownerId, key.ownerId), sql`${v.expiresAt} > now()`))
      .limit(1);
    return row ?? null;
  }
}
