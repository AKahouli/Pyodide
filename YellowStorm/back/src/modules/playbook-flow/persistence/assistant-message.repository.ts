import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';

const m = schema.playbookAssistantMessages;
type MessageRow = typeof m.$inferSelect;

export type PlaybookAssistantMessageRole = 'user' | 'assistant';
export type PlaybookAssistantMessageRecord = Omit<MessageRow, 'role'> & { role: PlaybookAssistantMessageRole };

export interface NewPlaybookAssistantMessage {
  messageId: string;
  requestId: string;
  conversationId: string;
  ownerId: string;
  playbookId: string;
  role: PlaybookAssistantMessageRole;
  content: string;
  operationId: string | null;
  expiresAt: Date;
}

/**
 * PostgreSQL playbook.assistant_messages repository (roadmap P5): the transcript of the Playbook
 * assistant, one user and one assistant message per request. TTL-swept on `expires_at` and
 * invisible here once expired.
 */
@Injectable()
export class PlaybookAssistantMessageRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private live(): SQL {
    return sql`${m.expiresAt} > now()`;
  }

  /**
   * Writes the `role` message of a request once: a retry keeps the first one, an expired one (the
   * TTL sweep has not run yet) is replaced as if it were gone.
   */
  async appendOnce(input: NewPlaybookAssistantMessage): Promise<void> {
    const now = new Date();
    const values = { ...input, content: stripNul(input.content), createdAt: now, updatedAt: now };
    await this.q
      .insert(m)
      .values({ id: newObjectId(), ...values })
      .onConflictDoUpdate({ target: [m.requestId, m.role], set: values, setWhere: sql`${m.expiresAt} <= now()` });
  }

  /** The conversation of the owner's most recent message on the Playbook. */
  async latestConversationId(ownerId: string, playbookId: string): Promise<string | null> {
    const [row] = await this.q
      .select({ conversationId: m.conversationId })
      .from(m)
      .where(and(eq(m.ownerId, ownerId), eq(m.playbookId, playbookId), this.live()))
      .orderBy(desc(m.createdAt), desc(m.id))
      .limit(1);
    return row?.conversationId ?? null;
  }

  /** The messages of one conversation, oldest first. */
  async listConversation(ownerId: string, playbookId: string, conversationId: string): Promise<PlaybookAssistantMessageRecord[]> {
    const rows = await this.q
      .select()
      .from(m)
      .where(and(eq(m.ownerId, ownerId), eq(m.playbookId, playbookId), eq(m.conversationId, conversationId), this.live()))
      .orderBy(asc(m.createdAt), asc(m.id));
    return rows as PlaybookAssistantMessageRecord[];
  }
}
