import { Inject, Injectable } from '@nestjs/common';
import { and, desc, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';

const dm = schema.playbookDesignMessages;
type DesignMessageRow = typeof dm.$inferSelect;

/** The graph of the flow as it was before a design turn. */
export interface PlaybookDesignSnapshot {
  nodes: Record<string, unknown>[];
  controlEdges: Record<string, unknown>[];
  dataBindings: Record<string, unknown>[];
}

export type PlaybookDesignMessageStatus = 'completed' | 'failed' | 'reverted';

export type PlaybookDesignMessageRecord = Omit<DesignMessageRow, 'snapshotBefore' | 'status'> & {
  snapshotBefore: PlaybookDesignSnapshot;
  status: PlaybookDesignMessageStatus;
};

export interface NewPlaybookDesignMessage {
  flowId: string;
  createdBy: string;
  userQuery: string;
  aiSummary: string;
  snapshotBefore: PlaybookDesignSnapshot;
  status: PlaybookDesignMessageStatus;
  error?: string | null;
  revertedFromMessageId?: string | null;
}

function toDesignMessageRecord(row: DesignMessageRow): PlaybookDesignMessageRecord {
  return row as unknown as PlaybookDesignMessageRecord;
}

/** PostgreSQL playbook.design_messages repository (roadmap P5): the designer's turn history of a flow, per user. */
@Injectable()
export class PlaybookDesignMessageRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async create(input: NewPlaybookDesignMessage): Promise<PlaybookDesignMessageRecord> {
    if (!isObjectId(input.flowId) || !isObjectId(input.createdBy)) {
      throw new Error('Design message flowId and createdBy must be 24-char hex ids');
    }
    const [row] = await this.q
      .insert(dm)
      .values({
        id: newObjectId(),
        flowId: normalizeObjectId(input.flowId),
        createdBy: normalizeObjectId(input.createdBy),
        userQuery: stripNul(input.userQuery),
        aiSummary: stripNul(input.aiSummary),
        snapshotBefore: stripNul(input.snapshotBefore) as unknown as Record<string, unknown>,
        status: input.status,
        error: input.error == null ? null : stripNul(input.error),
        revertedFromMessageId: input.revertedFromMessageId && isObjectId(input.revertedFromMessageId)
          ? normalizeObjectId(input.revertedFromMessageId)
          : null,
      })
      .returning();
    return toDesignMessageRecord(row);
  }

  /** The user's messages on the flow, newest first. */
  async listForUser(flowId: string, userId: string): Promise<PlaybookDesignMessageRecord[]> {
    if (!isObjectId(flowId) || !isObjectId(userId)) return [];
    const rows = await this.q
      .select()
      .from(dm)
      .where(and(eq(dm.flowId, normalizeObjectId(flowId)), eq(dm.createdBy, normalizeObjectId(userId))))
      .orderBy(desc(dm.createdAt), desc(dm.id));
    return rows.map(toDesignMessageRecord);
  }

  async findForUser(id: string, flowId: string, userId: string): Promise<PlaybookDesignMessageRecord | null> {
    if (!isObjectId(id) || !isObjectId(flowId) || !isObjectId(userId)) return null;
    const [row] = await this.q
      .select()
      .from(dm)
      .where(and(eq(dm.id, normalizeObjectId(id)), eq(dm.flowId, normalizeObjectId(flowId)), eq(dm.createdBy, normalizeObjectId(userId))))
      .limit(1);
    return row ? toDesignMessageRecord(row) : null;
  }

  /** Deletes the user's messages on the flow; the number deleted. */
  async deleteForUser(flowId: string, userId: string): Promise<number> {
    if (!isObjectId(flowId) || !isObjectId(userId)) return 0;
    const rows = await this.q
      .delete(dm)
      .where(and(eq(dm.flowId, normalizeObjectId(flowId)), eq(dm.createdBy, normalizeObjectId(userId))))
      .returning({ id: dm.id });
    return rows.length;
  }
}
