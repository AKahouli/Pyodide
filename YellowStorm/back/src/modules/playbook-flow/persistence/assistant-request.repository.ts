import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import { newObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import type { TrustedConversationPlaybookContextV1 } from '@modules/conversation/interfaces/conversation-playbook-handoff.interface';

const r = schema.playbookAssistantRequests;
type RequestRow = typeof r.$inferSelect;

export type PlaybookAssistantOperationKind = 'inspect' | 'existing_construction' | 'generation';
export type PlaybookAssistantRequestStatus = 'processing' | 'awaiting_clarification' | 'ready' | 'completed' | 'failed';

export interface PlaybookAssistantHandoffProvenance {
  handoffId: string;
  handoffVersion: 1;
  sourceConversationId: string;
  targetMessageId: string;
  displayedAnswerVersion: string;
  canonicalPathFingerprint: string;
  contextFingerprint: string;
  acceptedAt: string;
}

export type PlaybookAssistantRequestRecord = Omit<RequestRow, 'operationKind' | 'status' | 'handoffContext' | 'handoffProvenance'> & {
  operationKind: PlaybookAssistantOperationKind;
  status: PlaybookAssistantRequestStatus;
  handoffContext: TrustedConversationPlaybookContextV1 | null;
  handoffProvenance: PlaybookAssistantHandoffProvenance | null;
};

export interface NewPlaybookAssistantRequest {
  requestId: string;
  ownerId: string;
  agentId: string;
  conversationId: string;
  correlationId: string;
  operationKind: PlaybookAssistantOperationKind;
  playbookId: string | null;
  expectedDefinitionRevision: number | null;
  contextId: string;
  messageHash: string;
  originalText: string;
  requestedName?: string | null;
  handoffContext?: TrustedConversationPlaybookContextV1 | null;
  handoffProvenance?: PlaybookAssistantHandoffProvenance | null;
  workspaceDefaultIds?: string[];
  selectedTaskId: string | null;
  executionId: string | null;
  attachmentIds: string[];
  expiresAt: Date;
}

/** The actor a clarification is bound to. */
export interface PlaybookAssistantRequestActor {
  ownerId: string;
  agentId: string;
  conversationId: string;
  correlationId: string;
}

export function toAssistantRequestRecord(row: RequestRow): PlaybookAssistantRequestRecord {
  return {
    ...row,
    operationKind: row.operationKind as PlaybookAssistantOperationKind,
    status: row.status as PlaybookAssistantRequestStatus,
    handoffContext: row.handoffContext as unknown as TrustedConversationPlaybookContextV1 | null,
    handoffProvenance: row.handoffProvenance as unknown as PlaybookAssistantHandoffProvenance | null,
  };
}

const json = <T>(value: T | null | undefined): Record<string, unknown> | null =>
  value == null ? null : (stripNul(value) as unknown as Record<string, unknown>);

/**
 * PostgreSQL playbook.assistant_requests repository (roadmap P5). Rows are keyed by the string
 * `request_id` and expire through the TTL sweep on `expires_at`; until the sweep runs, an expired
 * row is invisible to every read and update here, as it was once Mongo's TTL monitor removed it.
 */
@Injectable()
export class PlaybookAssistantRequestRepository {
  constructor(@Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>) {}

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  private live(): SQL {
    return sql`${r.expiresAt} > now()`;
  }

  /**
   * Inserts the request, or takes over an expired row carrying the same `request_id`. Null when a
   * live request already holds the id (the caller decides between replay and conflict).
   */
  async insert(input: NewPlaybookAssistantRequest): Promise<PlaybookAssistantRequestRecord | null> {
    const now = new Date();
    const values = {
      requestId: input.requestId,
      ownerId: input.ownerId,
      agentId: input.agentId,
      conversationId: input.conversationId,
      correlationId: input.correlationId,
      operationKind: input.operationKind,
      playbookId: input.playbookId,
      expectedDefinitionRevision: input.expectedDefinitionRevision,
      contextId: input.contextId,
      messageHash: input.messageHash,
      originalText: stripNul(input.originalText),
      requestedName: input.requestedName == null ? null : stripNul(input.requestedName),
      handoffContext: json(input.handoffContext),
      handoffProvenance: json(input.handoffProvenance),
      workspaceDefaultIds: input.workspaceDefaultIds ?? [],
      selectedTaskId: input.selectedTaskId,
      executionId: input.executionId,
      attachmentIds: input.attachmentIds,
      continuationId: null,
      assessment: null,
      assessmentVersion: 0,
      answers: [],
      mutationOperationId: null,
      assistantAnswer: null,
      responsePayload: null,
      status: 'processing',
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    const [row] = await this.q
      .insert(r)
      .values({ id: newObjectId(), ...values })
      .onConflictDoUpdate({ target: r.requestId, set: values, setWhere: sql`${r.expiresAt} <= now()` })
      .returning();
    return row ? toAssistantRequestRecord(row) : null;
  }

  async findByRequestId(requestId: string, ownerId?: string): Promise<PlaybookAssistantRequestRecord | null> {
    const [row] = await this.q
      .select()
      .from(r)
      .where(and(eq(r.requestId, requestId), ownerId === undefined ? undefined : eq(r.ownerId, ownerId), this.live()))
      .limit(1);
    return row ? toAssistantRequestRecord(row) : null;
  }

  /** The first live request holding one of `requestIds` (a current and a legacy idempotency key). */
  async findFirstByRequestIds(requestIds: string[]): Promise<PlaybookAssistantRequestRecord | null> {
    if (requestIds.length === 0) return null;
    const [row] = await this.q
      .select()
      .from(r)
      .where(and(inArray(r.requestId, requestIds), this.live()))
      .orderBy(asc(r.createdAt), asc(r.id))
      .limit(1);
    return row ? toAssistantRequestRecord(row) : null;
  }

  /** Whether the owner has a live request in `conversationId` (on `playbookId` when given). */
  async conversationExists(ownerId: string, conversationId: string, playbookId?: string): Promise<boolean> {
    const rows = await this.q
      .select({ id: r.id })
      .from(r)
      .where(and(
        eq(r.conversationId, conversationId),
        eq(r.ownerId, ownerId),
        playbookId ? eq(r.playbookId, playbookId) : undefined,
        this.live(),
      ))
      .limit(1);
    return rows.length > 0;
  }

  /** The live clarification waiting behind `continuationId` for the owner. */
  async findAwaitingContinuation(continuationId: string, ownerId: string): Promise<PlaybookAssistantRequestRecord | null> {
    const [row] = await this.q
      .select()
      .from(r)
      .where(and(eq(r.continuationId, continuationId), eq(r.ownerId, ownerId), eq(r.status, 'awaiting_clarification'), this.live()))
      .limit(1);
    return row ? toAssistantRequestRecord(row) : null;
  }

  async findContinuation(continuationId: string, ownerId: string, playbookId: string, conversationId: string): Promise<PlaybookAssistantRequestRecord | null> {
    const [row] = await this.q
      .select()
      .from(r)
      .where(and(
        eq(r.continuationId, continuationId),
        eq(r.ownerId, ownerId),
        eq(r.playbookId, playbookId),
        eq(r.conversationId, conversationId),
        this.live(),
      ))
      .limit(1);
    return row ? toAssistantRequestRecord(row) : null;
  }

  private async updateWhere(where: SQL[], set: PgUpdateSetSource<typeof r>): Promise<RequestRow[]> {
    return this.q
      .update(r)
      .set({ ...set, updatedAt: new Date() })
      .where(and(...where, this.live()))
      .returning();
  }

  /** Moves a waiting clarification to the actor's new correlation id. False when none matches. */
  async rebindCorrelation(
    filter: { continuationId: string; playbookId?: string | null; ownerId: string; agentId: string; conversationId: string },
    correlationId: string,
  ): Promise<boolean> {
    const rows = await this.updateWhere([
      eq(r.continuationId, filter.continuationId),
      ...(filter.playbookId ? [eq(r.playbookId, filter.playbookId)] : []),
      eq(r.ownerId, filter.ownerId),
      eq(r.agentId, filter.agentId),
      eq(r.conversationId, filter.conversationId),
      eq(r.status, 'awaiting_clarification'),
    ], { correlationId });
    return rows.length > 0;
  }

  /** Starts an assessment attempt: the new `assessmentVersion`, or null when the request is not processing. */
  async claimAssessment(requestId: string): Promise<number | null> {
    const [row] = await this.q
      .update(r)
      .set({ assessmentVersion: sql`${r.assessmentVersion} + 1`, updatedAt: new Date() })
      .where(and(eq(r.requestId, requestId), eq(r.status, 'processing'), this.live()))
      .returning({ assessmentVersion: r.assessmentVersion });
    return row ? row.assessmentVersion : null;
  }

  /** Records the outcome of attempt `assessmentVersion`; null when a newer attempt or a transition won. */
  async saveAssessment(
    requestId: string,
    assessmentVersion: number,
    update: { assessment: Record<string, unknown>; continuationId: string | null; status: PlaybookAssistantRequestStatus; expiresAt: Date },
  ): Promise<PlaybookAssistantRequestRecord | null> {
    const [row] = await this.updateWhere(
      [eq(r.requestId, requestId), eq(r.assessmentVersion, assessmentVersion), eq(r.status, 'processing')],
      { assessment: json(update.assessment), continuationId: update.continuationId, status: update.status, expiresAt: update.expiresAt },
    );
    return row ? toAssistantRequestRecord(row) : null;
  }

  /** Consumes a clarification for the bound actor: exactly one caller wins. */
  async claimContinuation(
    filter: { requestId: string; continuationId: string } & PlaybookAssistantRequestActor,
    update: { answers: Record<string, unknown>[]; assessment: Record<string, unknown> },
  ): Promise<boolean> {
    const rows = await this.updateWhere([
      eq(r.requestId, filter.requestId),
      eq(r.continuationId, filter.continuationId),
      eq(r.status, 'awaiting_clarification'),
      eq(r.ownerId, filter.ownerId),
      eq(r.agentId, filter.agentId),
      eq(r.conversationId, filter.conversationId),
      eq(r.correlationId, filter.correlationId),
    ], { answers: stripNul(update.answers), assessment: json(update.assessment), continuationId: null, status: 'ready' });
    return rows.length > 0;
  }

  /** Puts a consumed clarification back while no construction has been claimed for it. */
  async restoreContinuation(requestId: string, continuationId: string): Promise<void> {
    await this.updateWhere(
      [eq(r.requestId, requestId), isNull(r.continuationId), eq(r.status, 'processing'), isNull(r.mutationOperationId)],
      { continuationId, status: 'awaiting_clarification' },
    );
  }

  /** Binds `operationId` as the request's single construction. False when another one holds it or the request is not ready. */
  async claimMutation(requestId: string, operationId: string): Promise<boolean> {
    const rows = await this.updateWhere(
      [eq(r.requestId, requestId), isNull(r.mutationOperationId), inArray(r.status, ['processing', 'ready'])],
      { mutationOperationId: operationId },
    );
    return rows.length > 0;
  }

  /** Records the answer; a request still awaiting clarification keeps that status. */
  async complete(requestId: string, answer: string, operationId?: string, responsePayload?: Record<string, unknown>): Promise<void> {
    await this.updateWhere([eq(r.requestId, requestId)], {
      status: sql`CASE WHEN ${r.status} = 'awaiting_clarification' THEN ${r.status} ELSE 'completed' END`,
      assistantAnswer: stripNul(answer),
      ...(operationId ? { mutationOperationId: operationId } : {}),
      ...(responsePayload ? { responsePayload: json(responsePayload) } : {}),
    });
  }

  async bindGeneratedPlaybook(requestId: string, playbookId: string, expectedDefinitionRevision: number): Promise<void> {
    await this.updateWhere([eq(r.requestId, requestId), eq(r.operationKind, 'generation')], { playbookId, expectedDefinitionRevision });
  }

  /** Forgets construction `operationId` and its generated Playbook; the request is ready again. */
  async resetMutation(requestId: string, operationId: string): Promise<boolean> {
    const rows = await this.updateWhere(
      [eq(r.requestId, requestId), eq(r.mutationOperationId, operationId)],
      { mutationOperationId: null, playbookId: null, expectedDefinitionRevision: null, status: 'ready' },
    );
    return rows.length > 0;
  }

  async releaseMutation(requestId: string, operationId: string): Promise<void> {
    await this.updateWhere([eq(r.requestId, requestId), eq(r.mutationOperationId, operationId)], { mutationOperationId: null });
  }

  async markFailed(requestId: string): Promise<void> {
    await this.updateWhere([eq(r.requestId, requestId)], { status: 'failed' });
  }
}
