import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newObjectId } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';

const a = schema.playbookAssistantAttachments;
type AttachmentRow = typeof a.$inferSelect;

export type PlaybookAssistantAttachmentRecord = Omit<AttachmentRow, 'status'> & { status: 'pending' | 'confirmed' };

export interface NewPlaybookAssistantAttachment {
  attachmentId: string;
  requestId: string;
  ownerId: string;
  playbookId: string;
  expectedDefinitionRevision: number;
  objectKey: string;
  mediaType: string;
  declaredSize: number;
  expiresAt: Date;
}

/**
 * PostgreSQL playbook.assistant_attachments repository (roadmap P5): images uploaded for an
 * assistant request. Not TTL-swept: the attachment service deletes the stored object first and
 * only then the row (`listExpired` / `deleteByAttachmentIds`), so no blob is left behind.
 */
@Injectable()
export class PlaybookAssistantAttachmentRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async insert(input: NewPlaybookAssistantAttachment): Promise<PlaybookAssistantAttachmentRecord> {
    const [row] = await this.q.insert(a).values({ id: newObjectId(), ...input, status: 'pending' }).returning();
    return row as PlaybookAssistantAttachmentRecord;
  }

  /** Unexpired attachments of the owner's request. */
  async countLiveForRequest(ownerId: string, requestId: string): Promise<number> {
    const [row] = await this.q
      .select({ count: sql<number>`count(*)::int` })
      .from(a)
      .where(and(eq(a.ownerId, ownerId), eq(a.requestId, requestId), sql`${a.expiresAt} > now()`));
    return row?.count ?? 0;
  }

  async findOwned(attachmentId: string, ownerId: string, playbookId: string): Promise<PlaybookAssistantAttachmentRecord | null> {
    const [row] = await this.q
      .select()
      .from(a)
      .where(and(eq(a.attachmentId, attachmentId), eq(a.ownerId, ownerId), eq(a.playbookId, playbookId)))
      .limit(1);
    return (row as PlaybookAssistantAttachmentRecord | undefined) ?? null;
  }

  async findByAttachmentIds(attachmentIds: string[]): Promise<PlaybookAssistantAttachmentRecord[]> {
    if (attachmentIds.length === 0) return [];
    return (await this.q.select().from(a).where(inArray(a.attachmentId, attachmentIds))) as PlaybookAssistantAttachmentRecord[];
  }

  async confirm(attachmentId: string, ownerId: string, playbookId: string, verified: { actualSize: number; contentSha256: string }): Promise<void> {
    await this.q
      .update(a)
      .set({ status: 'confirmed', actualSize: verified.actualSize, contentSha256: verified.contentSha256, updatedAt: new Date() })
      .where(and(eq(a.attachmentId, attachmentId), eq(a.ownerId, ownerId), eq(a.playbookId, playbookId)));
  }

  /** Confirmed, unexpired attachments among `attachmentIds` bound to exactly this owner, request, Playbook and revision. */
  async countConfirmedBindings(input: {
    attachmentIds: string[];
    ownerId: string;
    playbookId: string;
    requestId: string;
    expectedDefinitionRevision: number;
  }): Promise<number> {
    if (input.attachmentIds.length === 0) return 0;
    const [row] = await this.q
      .select({ count: sql<number>`count(*)::int` })
      .from(a)
      .where(and(
        inArray(a.attachmentId, input.attachmentIds),
        eq(a.ownerId, input.ownerId),
        eq(a.playbookId, input.playbookId),
        eq(a.requestId, input.requestId),
        eq(a.expectedDefinitionRevision, input.expectedDefinitionRevision),
        eq(a.status, 'confirmed'),
        sql`${a.expiresAt} > now()`,
      ));
    return row?.count ?? 0;
  }

  /** Up to `limit` expired attachments, oldest expiry first. */
  async listExpired(limit: number): Promise<PlaybookAssistantAttachmentRecord[]> {
    return (await this.q
      .select()
      .from(a)
      .where(lte(a.expiresAt, new Date()))
      .orderBy(asc(a.expiresAt), asc(a.id))
      .limit(limit)) as PlaybookAssistantAttachmentRecord[];
  }

  async deleteByAttachmentId(attachmentId: string): Promise<void> {
    await this.q.delete(a).where(eq(a.attachmentId, attachmentId));
  }

  async deleteByAttachmentIds(attachmentIds: string[]): Promise<void> {
    if (attachmentIds.length === 0) return;
    await this.q.delete(a).where(inArray(a.attachmentId, attachmentIds));
  }
}
