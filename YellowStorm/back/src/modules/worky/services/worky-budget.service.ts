import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { isForeignKeyViolation, isObjectId, withTransaction } from '@common/postgres';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { WorkyStreamRepository } from '../persistence/worky-stream.repository';
import { WorkyTaskRepository } from '../persistence/worky-task.repository';
import { WorkyBudgetRepository } from '../persistence/worky-budget.repository';
import { WorkyInteractionRepository } from '../persistence/worky-interaction.repository';
import { LoggerService } from '../../logger';
import { WorkyEventService } from './worky-event.service';
import { WorkyAuditService } from './worky-audit.service';

const OVERSPEND_BAND = 0.1;
const CATEGORY_DEFAULT_USD: Record<string, number> = {
  internal_analysis: 0.1,
  research: 0.25,
  drafting: 0.15,
  internal_artifact_write: 0.05,
  internal_platform_notification: 0.02,
  external_send: 0.2,
  customer_facing_release: 0.5,
  external_comms: 0.2,
  budget_overrun: 0,
  cancel_human_task: 0,
  replanning: 0.1,
};

export interface WorkyBudgetSnapshot {
  streamId: string;
  limitUsd: number;
  limitTokens: number;
  spendUsd: number;
  tokensUsed: number;
  enforcement: 'hard_stop' | 'notify';
  remainingUsd: number;
  remainingTokens: number;
  exhausted: boolean;
}

export interface WorkyReserveResult {
  status: 'reserved' | 'denied';
  reservationId?: string;
  amountUsd: number;
  tokens: number;
  reason?: string;
}

export interface WorkyRecordCostInput {
  streamId: string;
  taskId: string | null;
  type: 'llm' | 'tool' | 'embedding';
  provider: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface WorkyRecordCostResult {
  costEventId: string;
  totalCostUsd: number;
  totalTokens: number;
  overspend: boolean;
}

/**
 * Budgeted execution (Part 4 `docs/worky/04_HUMANS_BUDGET_REPORTS.md` §4,
 * canonical §8). The stream carries `budget.{limitUsd, limitTokens,
 * spendUsd, tokensUsed, enforcement}`; reservations are atomic via a
 * conditional UPDATE of the stream counters (`reserveBudget`).
 *
 *   reserve(input)         estimate → atomic reserve (denied if it
 *                           would push spendUsd past limitUsd) →
 *                           persist the reservation. On
 *                           denial with `enforcement='hard_stop'`,
 *                           create a `budget_decision` interaction
 *                           and set `status='waiting_for_budget_decision'`.
 *   release(reservationId) mark reservation 'released' and decrement
 *                           the stream's spendUsd/tokensUsed counters.
 *   recordCost(input)      Persist a cost event, bump the task
 *                           budget.actual*, and mark the task's open
 *                           reservations 'consumed' on overspend.
 *   getSnapshot(streamId)  Returns the live budget + remaining/used.
 *   setLimits(streamId, …) PATCH the stream's limitUsd/limitTokens/
 *                           enforcement (governance may gate this).
 */
@Injectable()
export class WorkyBudgetService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly streams: WorkyStreamRepository,
    private readonly tasks: WorkyTaskRepository,
    private readonly budgets: WorkyBudgetRepository,
    private readonly interactions: WorkyInteractionRepository,
    private readonly events: WorkyEventService,
    private readonly audit: WorkyAuditService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyBudgetService.name);
  }

  /**
   * Estimate the USD + token cost for a task. Prefers the runtime's
   * `budget.estimateUsd` / `budget.tokensEstimate`; falls back to a
   * conservative per-category default.
   */
  estimate(task: { actionCategory: string; budget: { estimateUsd: number; tokensEstimate: number } }): {
    amountUsd: number;
    tokens: number;
  } {
    const fallback = CATEGORY_DEFAULT_USD[task.actionCategory] ?? 0.1;
    return {
      amountUsd: task.budget.estimateUsd > 0 ? task.budget.estimateUsd : fallback,
      tokens: task.budget.tokensEstimate,
    };
  }

  /**
   * Atomic reserve. The counters always move, also on an unlimited
   * stream (a limit of 0 is unlimited inside the SQL guard), so
   * `release` stays symmetric. On denial under `hard_stop` we
   * transition the stream to `waiting_for_budget_decision` and raise a
   * `budget_decision` interaction.
   */
  async reserve(input: {
    streamId: string;
    taskId: string;
    amountUsd: number;
    tokens: number;
  }): Promise<WorkyReserveResult> {
    if (!isObjectId(input.streamId)) {
      throw new Error(`WorkyBudgetService.reserve: invalid streamId ${input.streamId}`);
    }
    if (!isObjectId(input.taskId)) {
      throw new Error(`WorkyBudgetService.reserve: invalid taskId ${input.taskId}`);
    }
    const stream = await this.streams.findById(input.streamId);
    if (!stream) {
      throw new Error(`WorkyBudgetService.reserve: stream ${input.streamId} not found`);
    }
    const outcome = await withTransaction(this.db, async () => {
      const reserved = await this.streams.reserveBudget(stream.id, input.amountUsd, input.tokens);
      const reservation = await this.budgets.createReservation({
        streamId: stream.id,
        taskId: input.taskId,
        amountUsd: input.amountUsd,
        tokens: input.tokens,
        status: reserved ? 'reserved' : 'denied',
      });
      if (!reserved && stream.budget.enforcement === 'hard_stop') {
        await this.streams.update(stream.id, { status: 'waiting_for_budget_decision' });
        await this.interactions.create({
          streamId: stream.id,
          taskId: input.taskId,
          type: 'budget_decision',
          targetUserId: stream.ownerUserId,
          question: `Budget exhausted on stream "${stream.title}". Increase limit, switch to notify, generate report, or stop?`,
          options: ['increase', 'cheaper_mode', 'report_now', 'stop'],
          blockingScope: 'stream',
          blocksTaskIds: [],
        });
      }
      return { reserved, reservationId: reservation.id };
    }).catch((err: unknown) => {
      // budget_reservations.task_id is a foreign key; the transaction also gave the counters back.
      if (isForeignKeyViolation(err)) {
        throw new Error(`WorkyBudgetService.reserve: task ${input.taskId} not found`);
      }
      throw err;
    });
    if (!outcome.reserved) {
      this.events.emit(stream.ownerUserId, stream.id, {
        type: 'budget.exhausted',
        emittedAt: Date.now(),
        payload: {
          reservationId: outcome.reservationId,
          amountUsd: input.amountUsd,
          tokens: input.tokens,
          limitUsd: stream.budget.limitUsd,
          limitTokens: stream.budget.limitTokens,
        },
      });
      this.events.emit(stream.ownerUserId, stream.id, {
        type: 'budget_decision.requested',
        emittedAt: Date.now(),
        payload: { taskId: input.taskId },
      });
      return {
        status: 'denied',
        amountUsd: input.amountUsd,
        tokens: input.tokens,
        reason: 'budget_exhausted',
      };
    }
    this.events.emit(stream.ownerUserId, stream.id, {
      type: 'budget.reserved',
      emittedAt: Date.now(),
      payload: {
        reservationId: outcome.reservationId,
        amountUsd: input.amountUsd,
        tokens: input.tokens,
      },
    });
    await this.audit.append({
      streamId: stream.id,
      action: 'budget.reserved',
      targetType: 'worky_reservation',
      targetId: outcome.reservationId,
      details: { amountUsd: input.amountUsd, tokens: input.tokens, taskId: input.taskId },
    });
    return {
      status: 'reserved',
      reservationId: outcome.reservationId,
      amountUsd: input.amountUsd,
      tokens: input.tokens,
    };
  }

  /**
   * Release a previously-reserved amount. Idempotent: if the
   * reservation is already 'released' or 'consumed' we no-op.
   */
  async release(reservationId: string): Promise<void> {
    if (!isObjectId(reservationId)) return;
    await withTransaction(this.db, async () => {
      const released = await this.budgets.transitionReservation(reservationId, 'reserved', 'released');
      if (!released) return;
      await this.streams.releaseBudget(released.streamId, released.amountUsd, released.tokens);
    });
  }

  /**
   * Record an actual cost event. Increments the task's budget.actual*.
   * Marks the task's open reservations 'consumed' if the actual exceeds
   * the estimate by more than `OVERSPEND_BAND`.
   */
  async recordCost(input: WorkyRecordCostInput): Promise<WorkyRecordCostResult> {
    if (!isObjectId(input.streamId)) {
      throw new Error(`WorkyBudgetService.recordCost: invalid streamId`);
    }
    const taskId = input.taskId && isObjectId(input.taskId) ? input.taskId : null;
    const { event, task } = await withTransaction(this.db, async () => {
      // cost_events.task_id is a foreign key: a task that does not exist (any more) leaves
      // the cost unattributed rather than losing the spend.
      const task = taskId
        ? await this.tasks.addActualCost(taskId, input.costUsd, input.inputTokens + input.outputTokens)
        : null;
      const event = await this.budgets.insertCostEvent({
        streamId: input.streamId,
        taskId: task?.id ?? null,
        type: input.type,
        provider: input.provider,
        modelId: input.modelId,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costUsd: input.costUsd,
      });
      return { event, task };
    }).catch((err: unknown) => {
      if (isForeignKeyViolation(err)) {
        throw new Error(`WorkyBudgetService.recordCost: stream ${input.streamId} not found`);
      }
      throw err;
    });
    // `actualUsd` already includes this cost (the update returns the row afterwards).
    const overspend =
      !!task && task.budget.estimateUsd > 0 && task.budget.actualUsd > task.budget.estimateUsd * (1 + OVERSPEND_BAND);
    if (task && overspend) {
      await this.budgets.consumeOpenReservations(task.id);
      const ownerStream = await this.streams.findById(task.streamId);
      const ownerUserId = ownerStream?.ownerUserId ?? '';
      if (!ownerUserId) {
        this.logger.warn('budget.exhausted: stream owner not found; SSE dropped', {
          streamId: input.streamId,
          taskId: input.taskId,
        });
      }
      this.events.emit(ownerUserId, input.streamId, {
        type: 'budget.exhausted',
        emittedAt: Date.now(),
        payload: {
          taskId: input.taskId,
          actualUsd: task.budget.actualUsd,
          estimateUsd: task.budget.estimateUsd,
        },
      });
    }
    const totals = await this.budgets.costTotals(input.streamId);
    return {
      costEventId: event.id,
      totalCostUsd: totals.totalCostUsd,
      totalTokens: totals.totalInputTokens + totals.totalOutputTokens,
      overspend,
    };
  }

  async getSnapshot(streamId: string): Promise<WorkyBudgetSnapshot> {
    if (!isObjectId(streamId)) {
      throw new Error(`WorkyBudgetService.getSnapshot: invalid streamId`);
    }
    const stream = await this.streams.findById(streamId);
    if (!stream) {
      throw new Error(`WorkyBudgetService.getSnapshot: stream ${streamId} not found`);
    }
    const b = stream.budget;
    return {
      streamId,
      limitUsd: b.limitUsd,
      limitTokens: b.limitTokens,
      spendUsd: b.spendUsd,
      tokensUsed: b.tokensUsed,
      enforcement: b.enforcement,
      remainingUsd: b.limitUsd > 0 ? Math.max(0, b.limitUsd - b.spendUsd) : Number.POSITIVE_INFINITY,
      remainingTokens: b.limitTokens > 0 ? Math.max(0, b.limitTokens - b.tokensUsed) : Number.POSITIVE_INFINITY,
      exhausted:
        (b.limitUsd > 0 && b.spendUsd >= b.limitUsd) ||
        (b.limitTokens > 0 && b.tokensUsed >= b.limitTokens),
    };
  }

  async setLimits(
    streamId: string,
    limits: { limitUsd: number; limitTokens: number; enforcement: 'hard_stop' | 'notify' },
  ): Promise<WorkyBudgetSnapshot> {
    if (!isObjectId(streamId)) {
      throw new Error(`WorkyBudgetService.setLimits: invalid streamId`);
    }
    await this.streams.setBudgetLimits(streamId, limits);
    const stream = await this.streams.findById(streamId);
    if (stream) {
      this.events.emit(stream.ownerUserId, streamId, {
        type: 'budget.updated',
        emittedAt: Date.now(),
        payload: limits,
      });
    }
    return this.getSnapshot(streamId);
  }
}
