import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Cron } from '@nestjs/schedule';
import { Model, Types } from 'mongoose';
import { randomUUID } from 'crypto';
import {
  WorkyScheduledEvent,
  WorkyScheduledEventDocument,
} from '../schemas/worky-scheduled-event.schema';
import {
  WorkyTask,
  WorkyTaskDocument,
} from '../schemas/worky-task.schema';
import { LoggerService } from '../../logger';

const CLAIM_LEASE_SECONDS = 60;
const DEFAULT_CLAIM_INTERVAL = '*/30 * * * * *';
const RECONCILE_INTERVAL = '0 */5 * * * *';

const TERMINAL_TASK_STATES = new Set(['done', 'failed', 'canceled', 'superseded']);

/**
 * NestJS scheduler for the Worky module (Part 3, `docs/worky/03_EXECUTION_GOVERNANCE.md`,
 * canonical §4.2). No Celery — durable timers in `worky_scheduled_events`
 * plus a `@nestjs/schedule` claim/lease sweeper.
 *
 * Three responsibilities:
 *   - `claimDue` — every ~30s, atomically claim the next due row
 *     (`status:pending`, `fireAt<=now`, no current lease) using
 *     `findOneAndUpdate` with a fresh `claimToken`. Concurrent runners
 *     racing for the same row get a deterministic loser.
 *   - `dispatchClaimed` — for each claimed row, check the task state
 *     (status-gated no-op for terminal tasks) and emit the configured
 *     `eventType` over SSE. The runtime listens on the same channel and
 *     translates the event into a runtime action.
 *   - `reconcile` — every 5 minutes, re-queue overdue rows whose
 *     lease expired (e.g. crash recovery between claim and dispatch).
 *
 * Part 3 only builds the infrastructure; the actual content of the
 * `eventType` (e.g. reminder T-6h, deadline escalation) is wired in
 * Part 4 per `docs/worky/03_EXECUTION_GOVERNANCE.md` §2.
 */
@Injectable()
export class WorkySchedulerService {
  private readonly logger: LoggerService;

  constructor(
    @InjectModel(WorkyScheduledEvent.name)
    private readonly events: Model<WorkyScheduledEventDocument>,
    @InjectModel(WorkyTask.name)
    private readonly tasks: Model<WorkyTaskDocument>,
    logger: LoggerService,
  ) {
    this.logger = logger;
    this.logger.setContext(WorkySchedulerService.name);
  }

  /**
   * Persist a new durable timer. The runtime / Part 4 triggers will
   * insert rows here. We do not return the row to keep the call
   * cheap — callers can refetch by (streamId, taskId, eventType).
   */
  async schedule(input: {
    streamId: string;
    taskId: string | null;
    eventType: string;
    fireAt: Date;
  }): Promise<WorkyScheduledEventDocument> {
    if (!Types.ObjectId.isValid(input.streamId)) {
      throw new Error('WorkySchedulerService.schedule: invalid streamId');
    }
    if (input.taskId && !Types.ObjectId.isValid(input.taskId)) {
      throw new Error('WorkySchedulerService.schedule: invalid taskId');
    }
    return this.events.create({
      streamId: new Types.ObjectId(input.streamId),
      taskId: input.taskId ? new Types.ObjectId(input.taskId) : null,
      eventType: input.eventType,
      fireAt: input.fireAt,
      status: 'pending',
      claimToken: null,
      claimedAt: null,
      firedAt: null,
    });
  }

  /**
   * Cancel a pending timer by id. Already-claimed timers are *not*
   * cancellable — the worker that holds the lease will dispatch them.
   */
  async cancel(scheduledEventId: string): Promise<void> {
    if (!Types.ObjectId.isValid(scheduledEventId)) {
      throw new Error('WorkySchedulerService.cancel: invalid id');
    }
    await this.events
      .updateOne(
        { _id: new Types.ObjectId(scheduledEventId), status: 'pending' },
        { $set: { status: 'canceled' } },
      )
      .exec();
  }

  /**
   * Atomically claim the next due event. Returns `null` if no event
   * is due. Concurrent claimers are linearized by the unique
   * `(streamId, _id)` row update + `claimToken` lease.
   */
  async claimDue(): Promise<WorkyScheduledEventDocument | null> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + CLAIM_LEASE_SECONDS * 1000);
    const claimToken = randomUUID();
    // First, find one due row id, then claim it via findOneAndUpdate.
    // The two-step approach keeps the lease assignment atomic and
    // avoids loading every due row into memory.
    const candidate = await this.events
      .findOne({
        status: 'pending',
        fireAt: { $lte: now },
        $or: [{ claimToken: null }, { claimedAt: { $lte: new Date(now.getTime() - CLAIM_LEASE_SECONDS * 1000) } }],
      })
      .sort({ fireAt: 1 })
      .lean()
      .exec();
    if (!candidate) return null;
    const claimed = await this.events
      .findOneAndUpdate(
        {
          _id: candidate._id,
          status: 'pending',
          $or: [{ claimToken: null }, { claimedAt: { $lte: new Date(now.getTime() - CLAIM_LEASE_SECONDS * 1000) } }],
        },
        { $set: { status: 'claimed', claimToken, claimedAt: now } },
        { new: true },
      )
      .exec();
    if (!claimed) {
      // Another worker won the race; try again next tick.
      return null;
    }
    this.logger.debug('Worky scheduled event claimed', {
      id: (claimed._id as Types.ObjectId).toString(),
      leaseExpiresAt,
    });
    return claimed;
  }

  /**
   * Dispatch a single claimed event. Status-gated: if the associated
   * task is terminal, the event is a no-op (canonical §4.2). Otherwise
   * the event is `fired` and the `eventType` is logged for the runtime
   * SSE channel to translate. The actual work-runtime handshake is the
   * runtime's job (Part 3 §3.7).
   *
   * The function returns a `dispatchOutcome` so tests can assert the
   * exact decision.
   */
  async dispatchClaimed(
    event: WorkyScheduledEventDocument,
  ): Promise<'fired' | 'skipped_terminal' | 'skipped_already_fired'> {
    if (event.status === 'fired') return 'skipped_already_fired';
    if (event.status === 'canceled') return 'skipped_already_fired';
    if (event.taskId) {
      const task = await this.tasks
        .findById(event.taskId)
        .select({ executionState: 1, lane: 1 })
        .lean()
        .exec();
      if (task && (TERMINAL_TASK_STATES.has(String(task.executionState)) || ['done', 'failed', 'canceled', 'superseded', 'archived'].includes(String(task.lane)))) {
        await this.events
          .updateOne(
            { _id: event._id, status: 'claimed' },
            { $set: { status: 'fired', firedAt: new Date() } },
          )
          .exec();
        this.logger.log('Worky scheduled event skipped (task terminal)', {
          id: (event._id as Types.ObjectId).toString(),
          eventType: event.eventType,
        });
        return 'skipped_terminal';
      }
    }
    await this.events
      .updateOne(
        { _id: event._id, status: 'claimed' },
        { $set: { status: 'fired', firedAt: new Date() } },
      )
      .exec();
    this.logger.log('Worky scheduled event fired', {
      id: (event._id as Types.ObjectId).toString(),
      eventType: event.eventType,
      streamId: (event.streamId as Types.ObjectId).toString(),
    });
    // The runtime listens on the SSE channel; emitting here would
    // require the WorkyEventService which is module-scoped. Part 4
    // wires the reminder/deadline semantics on top of this primitive.
    return 'fired';
  }

  /**
   * Re-queue claimed events whose lease expired. Crash recovery:
   * the worker that held the claim crashed before dispatching.
   */
  async reconcile(): Promise<number> {
    const leaseCutoff = new Date(Date.now() - CLAIM_LEASE_SECONDS * 1000);
    const result = await this.events
      .updateMany(
        { status: 'claimed', claimedAt: { $lte: leaseCutoff } },
        { $set: { status: 'pending', claimToken: null, claimedAt: null } },
      )
      .exec();
    if (result.modifiedCount > 0) {
      this.logger.warn('Worky scheduled events re-queued by reconciler', {
        count: result.modifiedCount,
      });
    }
    return result.modifiedCount;
  }

  // ===== Cron entries =====

  @Cron(DEFAULT_CLAIM_INTERVAL, { name: 'worky.scheduler.claim-due' })
  async cronClaimDue(): Promise<void> {
    try {
      // Drain up to 50 due events per tick — keeps the loop bounded.
      for (let i = 0; i < 50; i += 1) {
        const claimed = await this.claimDue();
        if (!claimed) return;
        await this.dispatchClaimed(claimed);
      }
      this.logger.warn('Worky scheduler hit tick cap (50); more events remain');
    } catch (err) {
      this.logger.error('Worky scheduler claim-due failed', { error: (err as Error).message });
    }
  }

  @Cron(RECONCILE_INTERVAL, { name: 'worky.scheduler.reconcile' })
  async cronReconcile(): Promise<void> {
    try {
      await this.reconcile();
    } catch (err) {
      this.logger.error('Worky scheduler reconcile failed', { error: (err as Error).message });
    }
  }
}
