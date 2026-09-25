import { Inject, Injectable } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isObjectId, newObjectId, normalizeObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type {
  FlowMailEventLedgerStatus,
  FlowMailMessageAttachmentData,
  FlowMailSenderData,
} from '../interfaces/playbook-flow-mail.interface';
import { castMailAttachments, castMailParticipant, castMailParticipants } from './mail-cast';

const ml = schema.playbookMailEventLedgers;
type MailEventLedgerRow = typeof ml.$inferSelect;

/**
 * One playbook.mail_event_ledgers row. `ledgerId` is the id the mail code generates and addresses the
 * entry by (the Mongo document's `id` field); `id` is the row key. The execution is a soft reference.
 */
export interface MailEventLedgerRecord {
  id: string;
  ledgerId: string;
  flowId: string;
  dedupeKey: string;
  status: FlowMailEventLedgerStatus;
  provider: string;
  mailboxAppKey: string;
  providerMessageId: string;
  providerThreadId: string | null;
  receivedAt: Date;
  occurredAt: Date;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  from: FlowMailSenderData;
  to: FlowMailSenderData[];
  cc: FlowMailSenderData[];
  hasAttachments: boolean;
  attachments: FlowMailMessageAttachmentData[];
  error: string | null;
  executionId: string | null;
  createdAt: Date;
}

export type NewMailEventLedger = Omit<MailEventLedgerRecord, 'id' | 'executionId'>;

function toRecord(row: MailEventLedgerRow): MailEventLedgerRecord {
  const { fromParticipant, toParticipants, ccParticipants, ...rest } = row;
  return {
    ...rest,
    status: row.status as FlowMailEventLedgerStatus,
    from: fromParticipant as unknown as FlowMailSenderData,
    to: toParticipants as unknown as FlowMailSenderData[],
    cc: ccParticipants as unknown as FlowMailSenderData[],
    attachments: row.attachments as unknown as FlowMailMessageAttachmentData[],
  };
}

const textOrNull = (value: string | null | undefined): string | null => (value == null ? null : stripNul(value));

/** PostgreSQL playbook.mail_event_ledgers repository (roadmap P5). One entry per (flow, dedupe key). */
@Injectable()
export class MailEventLedgerRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  /**
   * Records a mail event unless the flow already has one with the same dedupe key: the new record, or
   * null for a duplicate. ON CONFLICT DO NOTHING, so a repeat neither fails nor aborts an ambient
   * transaction. A flow that does not exist surfaces as a foreign-key violation.
   */
  async insertIfNew(input: NewMailEventLedger): Promise<MailEventLedgerRecord | null> {
    if (!isObjectId(input.flowId)) throw new Error('Mail ledger flowId must be a 24-char hex id');
    const [row] = await this.q
      .insert(ml)
      .values({
        id: newObjectId(),
        ledgerId: input.ledgerId,
        flowId: normalizeObjectId(input.flowId),
        dedupeKey: stripNul(input.dedupeKey),
        status: input.status,
        provider: stripNul(input.provider),
        mailboxAppKey: stripNul(input.mailboxAppKey),
        providerMessageId: stripNul(input.providerMessageId),
        providerThreadId: textOrNull(input.providerThreadId),
        receivedAt: input.receivedAt,
        occurredAt: input.occurredAt,
        subject: stripNul(input.subject ?? ''),
        bodyText: stripNul(input.bodyText ?? ''),
        bodyHtml: textOrNull(input.bodyHtml),
        fromParticipant: castMailParticipant(input.from) as unknown as Record<string, unknown>,
        toParticipants: castMailParticipants(input.to) as unknown as Record<string, unknown>[],
        ccParticipants: castMailParticipants(input.cc) as unknown as Record<string, unknown>[],
        hasAttachments: input.hasAttachments === true,
        attachments: castMailAttachments(input.attachments) as unknown as Record<string, unknown>[],
        error: textOrNull(input.error),
        executionId: null,
        createdAt: input.createdAt,
      })
      .onConflictDoNothing({ target: [ml.flowId, ml.dedupeKey] })
      .returning();
    return row ? toRecord(row) : null;
  }

  async findByDedupeKey(flowId: string, dedupeKey: string): Promise<MailEventLedgerRecord | null> {
    if (!isObjectId(flowId)) return null;
    const [row] = await this.q
      .select()
      .from(ml)
      .where(and(eq(ml.flowId, normalizeObjectId(flowId)), eq(ml.dedupeKey, dedupeKey)))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  /** The entry of `ledgerId` in the flow. */
  async findByLedgerId(ledgerId: string, flowId: string): Promise<MailEventLedgerRecord | null> {
    if (!isObjectId(flowId)) return null;
    const [row] = await this.q
      .select()
      .from(ml)
      .where(and(eq(ml.ledgerId, ledgerId), eq(ml.flowId, normalizeObjectId(flowId))))
      .limit(1);
    return row ? toRecord(row) : null;
  }

  /** Records the outcome of the trigger filters. */
  async setStatus(ledgerId: string, status: FlowMailEventLedgerStatus, error: string | null): Promise<boolean> {
    const rows = await this.q
      .update(ml)
      .set({ status, error: textOrNull(error) })
      .where(eq(ml.ledgerId, ledgerId))
      .returning({ id: ml.id });
    return rows.length > 0;
  }

  /** Replaces the entry's attachments with the result of their import. */
  async setAttachments(ledgerId: string, attachments: FlowMailMessageAttachmentData[]): Promise<boolean> {
    const rows = await this.q
      .update(ml)
      .set({ attachments: castMailAttachments(attachments) as unknown as Record<string, unknown>[] })
      .where(eq(ml.ledgerId, ledgerId))
      .returning({ id: ml.id });
    return rows.length > 0;
  }

  /**
   * Marks a matched entry handed off to `executionId`, only while it is still `matched`: false when
   * another hand-off got there first.
   */
  async markHandedOff(ledgerId: string, executionId: string): Promise<boolean> {
    const rows = await this.q
      .update(ml)
      .set({ status: 'handed_off', executionId: isObjectId(executionId) ? normalizeObjectId(executionId) : null, error: null })
      .where(and(eq(ml.ledgerId, ledgerId), eq(ml.status, 'matched')))
      .returning({ id: ml.id });
    return rows.length > 0;
  }
}
