import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WorkyStream,
  WorkyStreamDocument,
} from '../schemas/worky-stream.schema';
import {
  WorkyTask,
  WorkyTaskDocument,
} from '../schemas/worky-task.schema';
import {
  WorkyBudgetReservation,
  WorkyBudgetReservationDocument,
} from '../schemas/worky-budget-reservation.schema';
import {
  WorkyCostEvent,
  WorkyCostEventDocument,
} from '../schemas/worky-cost-event.schema';
import {
  WorkyInteraction,
  WorkyInteractionDocument,
} from '../schemas/worky-interaction.schema';
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
 * spendUsd, tokensUsed, enforcement}`; reservations are atomic via
 * `findOneAndUpdate` with a conditional guard.
 *
 *   reserve(input)         estimate → atomic reserve (denied if it
 *                           would push spendUsd past limitUsd) →
 *                           persist `WorkyBudgetReservation`. On
 *                           denial with `enforcement='hard_stop'`,
 *                           create a `budget_decision` interaction
 *                           and set `status='waiting_for_budget_decision'`.
 *   release(reservationId) mark reservation 'released' and decrement
 *                           the stream's spendUsd/tokensUsed counters.
 *   recordCost(input)      Persist a `WorkyCostEvent`, bump the task
 *                           budget.actual*, and (if the reservation
 *                           exists) mark it 'consumed'. Emits
 *                           'cost.recorded' SSE for the UI.
 *   getSnapshot(streamId)  Returns the live budget + remaining/used.
 *   setLimits(streamId, …) PATCH the stream's limitUsd/limitTokens/
 *                           enforcement (governance may gate this).
 */
@Injectable()
export class WorkyBudgetService {
  constructor(
    @InjectModel(WorkyStream.name)
    private readonly streams: Model<WorkyStreamDocument>,
    @InjectModel(WorkyTask.name)
    private readonly tasks: Model<WorkyTaskDocument>,
    @InjectModel(WorkyBudgetReservation.name)
    private readonly reservations: Model<WorkyBudgetReservationDocument>,
    @InjectModel(WorkyCostEvent.name)
    private readonly costEvents: Model<WorkyCostEventDocument>,
    @InjectModel(WorkyInteraction.name)
    private readonly interactions: Model<WorkyInteractionDocument>,
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
   * Atomic reserve. If the stream's limitUsd/limitTokens are 0
   * (unlimited) the reservation is auto-accepted. Otherwise we run a
   * `findOneAndUpdate` with a `spendUsd+amount<=limit` guard. On
   * denial under `hard_stop` we transition the stream to
   * `waiting_for_budget_decision` and raise a `budget_decision`
   * interaction.
   */
  async reserve(input: {
    streamId: string;
    taskId: string;
    amountUsd: number;
    tokens: number;
  }): Promise<WorkyReserveResult> {
    if (!Types.ObjectId.isValid(input.streamId)) {
      throw new Error(`WorkyBudgetService.reserve: invalid streamId ${input.streamId}`);
    }
    if (!Types.ObjectId.isValid(input.taskId)) {
      throw new Error(`WorkyBudgetService.reserve: invalid taskId ${input.taskId}`);
    }
    const stream = await this.streams.findById(input.streamId).exec();
    if (!stream) {
      throw new Error(`WorkyBudgetService.reserve: stream ${input.streamId} not found`);
    }
    const unlimitedUsd = !stream.budget.limitUsd || stream.budget.limitUsd === 0;
    const unlimitedTokens = !stream.budget.limitTokens || stream.budget.limitTokens === 0;
    if (unlimitedUsd && unlimitedTokens) {
      const reservation = await this.reservations.create({
        streamId: stream._id,
        taskId: new Types.ObjectId(input.taskId),
        amountUsd: input.amountUsd,
        tokens: input.tokens,
        status: 'reserved',
      });
      this.events.emit(stream.ownerUserId.toString(), stream._id.toString(), {
        type: 'budget.reserved',
        emittedAt: Date.now(),
        payload: {
          reservationId: reservation._id.toString(),
          amountUsd: input.amountUsd,
          tokens: input.tokens,
        },
      });
      return { status: 'reserved', reservationId: reservation._id.toString(), amountUsd: input.amountUsd, tokens: input.tokens };
    }
    const usdGuard = unlimitedUsd
      ? {}
      : { $expr: { $lte: [{ $add: ['$budget.spendUsd', input.amountUsd] }, '$budget.limitUsd'] } };
    const tokensGuard = unlimitedTokens
      ? {}
      : { $expr: { $lte: [{ $add: ['$budget.tokensUsed', input.tokens] }, '$budget.limitTokens'] } };
    const updated = await this.streams
      .findOneAndUpdate(
        { _id: stream._id, ...usdGuard, ...tokensGuard },
        {
          $inc: {
            'budget.spendUsd': input.amountUsd,
            'budget.tokensUsed': input.tokens,
          },
          $set: { lastActivityAt: new Date() },
        },
        { new: true },
      )
      .exec();
    if (!updated) {
      const reservation = await this.reservations.create({
        streamId: stream._id,
        taskId: new Types.ObjectId(input.taskId),
        amountUsd: input.amountUsd,
        tokens: input.tokens,
        status: 'denied',
      });
      if (stream.budget.enforcement === 'hard_stop') {
        await this.streams
          .updateOne(
            { _id: stream._id },
            { $set: { status: 'waiting_for_budget_decision' } },
          )
          .exec();
        await this.interactions.create({
          streamId: stream._id,
          taskId: new Types.ObjectId(input.taskId),
          type: 'budget_decision',
          targetUserId: stream.ownerUserId,
          question: `Budget exhausted on stream "${stream.title}". Increase limit, switch to notify, generate report, or stop?`,
          options: ['increase', 'cheaper_mode', 'report_now', 'stop'],
          status: 'pending',
          blockingScope: 'stream',
          blocksTaskIds: [],
          respondedAt: null,
          response: null,
        });
      }
      this.events.emit(stream.ownerUserId.toString(), stream._id.toString(), {
        type: 'budget.exhausted',
        emittedAt: Date.now(),
        payload: {
          reservationId: reservation._id.toString(),
          amountUsd: input.amountUsd,
          tokens: input.tokens,
          limitUsd: stream.budget.limitUsd,
          limitTokens: stream.budget.limitTokens,
        },
      });
      this.events.emit(stream.ownerUserId.toString(), stream._id.toString(), {
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
    const reservation = await this.reservations.create({
      streamId: stream._id,
      taskId: new Types.ObjectId(input.taskId),
      amountUsd: input.amountUsd,
      tokens: input.tokens,
      status: 'reserved',
    });
    this.events.emit(stream.ownerUserId.toString(), stream._id.toString(), {
      type: 'budget.reserved',
      emittedAt: Date.now(),
      payload: {
        reservationId: reservation._id.toString(),
        amountUsd: input.amountUsd,
        tokens: input.tokens,
      },
    });
    await this.audit.append({
      streamId: stream._id.toString(),
      action: 'budget.reserved',
      targetType: 'worky_reservation',
      targetId: reservation._id.toString(),
      details: { amountUsd: input.amountUsd, tokens: input.tokens, taskId: input.taskId },
    });
    return {
      status: 'reserved',
      reservationId: reservation._id.toString(),
      amountUsd: input.amountUsd,
      tokens: input.tokens,
    };
  }

  /**
   * Release a previously-reserved amount. Idempotent: if the
   * reservation is already 'released' or 'consumed' we no-op.
   */
  async release(reservationId: string): Promise<void> {
    if (!Types.ObjectId.isValid(reservationId)) return;
    const reservation = await this.reservations.findById(reservationId).exec();
    if (!reservation) return;
    if (reservation.status !== 'reserved') return;
    const updated = await this.reservations
      .findOneAndUpdate(
        { _id: reservation._id, status: 'reserved' },
        { $set: { status: 'released' } },
        { new: true },
      )
      .exec();
    if (!updated) return;
    await this.streams
      .updateOne(
        { _id: reservation.streamId },
        {
          $inc: {
            'budget.spendUsd': -reservation.amountUsd,
            'budget.tokensUsed': -reservation.tokens,
          },
        },
      )
      .exec();
  }

  /**
   * Record an actual cost event. Increments the task's budget.actual*
   * and the stream's spend counters. Marks the corresponding
   * reservation 'consumed' if the actual exceeds the estimate by
   * more than `OVERSPEND_BAND`.
   */
  async recordCost(input: WorkyRecordCostInput): Promise<WorkyRecordCostResult> {
    if (!Types.ObjectId.isValid(input.streamId)) {
      throw new Error(`WorkyBudgetService.recordCost: invalid streamId`);
    }
    const event = await this.costEvents.create({
      streamId: new Types.ObjectId(input.streamId),
      taskId: input.taskId && Types.ObjectId.isValid(input.taskId) ? new Types.ObjectId(input.taskId) : null,
      type: input.type,
      provider: input.provider,
      modelId: input.modelId,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      costUsd: input.costUsd,
    });
    let overspend = false;
    if (input.taskId && Types.ObjectId.isValid(input.taskId)) {
      await this.tasks
        .updateOne(
          { _id: new Types.ObjectId(input.taskId) },
          {
            $inc: {
              'budget.actualUsd': input.costUsd,
              'budget.tokensActual': input.inputTokens + input.outputTokens,
            },
          },
        )
        .exec();
      const task = await this.tasks
        .findById(input.taskId)
        .select({ streamId: 1, budget: 1 })
        .lean()
        .exec();
      if (task && task.budget.estimateUsd > 0) {
        const ceiling = task.budget.estimateUsd * (1 + OVERSPEND_BAND);
        if (task.budget.actualUsd > ceiling) {
          overspend = true;
        }
      }
      if (overspend) {
        await this.reservations
          .updateOne(
            { taskId: new Types.ObjectId(input.taskId), status: 'reserved' },
            { $set: { status: 'consumed' } },
          )
          .exec();
        const ownerStream = await this.streams
          .findById(task?.streamId ?? input.streamId)
          .select({ ownerUserId: 1 })
          .lean()
          .exec();
        const ownerUserId = ownerStream?.ownerUserId.toString() ?? '';
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
            actualUsd: task?.budget.actualUsd ?? 0,
            estimateUsd: task?.budget.estimateUsd ?? 0,
          },
        });
      }
    }
    const agg = await this.costEvents
      .aggregate([
        { $match: { streamId: new Types.ObjectId(input.streamId) } },
        {
          $group: {
            _id: null,
            totalCostUsd: { $sum: '$costUsd' },
            totalTokens: { $sum: { $add: ['$inputTokens', '$outputTokens'] } },
          },
        },
      ])
      .exec();
    const totals = agg[0] ?? { totalCostUsd: 0, totalTokens: 0 };
    return {
      costEventId: event._id.toString(),
      totalCostUsd: totals.totalCostUsd,
      totalTokens: totals.totalTokens,
      overspend,
    };
  }

  async getSnapshot(streamId: string): Promise<WorkyBudgetSnapshot> {
    if (!Types.ObjectId.isValid(streamId)) {
      throw new Error(`WorkyBudgetService.getSnapshot: invalid streamId`);
    }
    const stream = await this.streams.findById(streamId).lean().exec();
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
    if (!Types.ObjectId.isValid(streamId)) {
      throw new Error(`WorkyBudgetService.setLimits: invalid streamId`);
    }
    await this.streams
      .updateOne(
        { _id: new Types.ObjectId(streamId) },
        {
          $set: {
            'budget.limitUsd': limits.limitUsd,
            'budget.limitTokens': limits.limitTokens,
            'budget.enforcement': limits.enforcement,
          },
        },
      )
      .exec();
    const stream = await this.streams.findById(streamId).exec();
    if (stream) {
      this.events.emit(stream.ownerUserId.toString(), streamId, {
        type: 'budget.updated',
        emittedAt: Date.now(),
        payload: limits,
      });
    }
    return this.getSnapshot(streamId);
  }
}
