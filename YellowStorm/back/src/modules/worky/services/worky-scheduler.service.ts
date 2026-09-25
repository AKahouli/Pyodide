import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'crypto';
import { isObjectId } from '@common/postgres';
import { WorkySchedulerRepository } from '../persistence/worky-scheduler.repository';
import { WorkyTaskRepository } from '../persistence/worky-task.repository';
import type { WorkyScheduledEventRecord } from '../worky.types';
import { LoggerService } from '../../logger';

const CLAIM_LEASE_SECONDS = 60;
const DEFAULT_CLAIM_INTERVAL = '*/30 * * * * *';
const RECONCILE_INTERVAL = '0 */5 * * * *';

const TERMINAL_TASK_STATES = new Set(['done', 'failed', 'canceled', 'superseded']);
const TERMINAL_TASK_LANES = new Set(['done', 'failed', 'canceled', 'superseded', 'archived']);

/**
 * NestJS scheduler for the Worky module (Part 3, `docs/worky/03_EXECUTION_GOVERNANCE.md`,
 * canonical §4.2). No Celery — durable timers in `worky.scheduled_events`
 * plus a `@nestjs/schedule` claim/lease sweeper.
 *
 * Three responsibilities:
 *   - `claimDue` — every ~30s, atomically claim the next due row
 *     (`status:pending`, `fireAt<=now`) with a fresh `claimToken` in one
 *     `FOR UPDATE SKIP LOCKED` statement. Concurrent runners never take
 *     the same row.
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
    private readonly timers: WorkySchedulerRepository,
    private readonly tasks: WorkyTaskRepository,
    logger: LoggerService,
  ) {
    this.logger = logger;
    this.logger.setContext(WorkySchedulerService.name);
  }

  /** Persist a new durable timer. The runtime / Part 4 triggers insert rows here. */
  async schedule(input: {
    streamId: string;
    taskId: string | null;
    eventType: string;
    fireAt: Date;
  }): Promise<WorkyScheduledEventRecord> {
    if (!isObjectId(input.streamId)) {
      throw new Error('WorkySchedulerService.schedule: invalid streamId');
    }
    if (input.taskId && !isObjectId(input.taskId)) {
      throw new Error('WorkySchedulerService.schedule: invalid taskId');
    }
    return this.timers.create({
      streamId: input.streamId,
      taskId: input.taskId || null,
      eventType: input.eventType,
      fireAt: input.fireAt,
    });
  }

  /**
   * Cancel a pending timer by id. Already-claimed timers are *not*
   * cancellable — the worker that holds the lease will dispatch them.
   */
  async cancel(scheduledEventId: string): Promise<void> {
    if (!isObjectId(scheduledEventId)) {
      throw new Error('WorkySchedulerService.cancel: invalid id');
    }
    await this.timers.cancelPending(scheduledEventId);
  }

  /**
   * Atomically claim the next due event. Returns `null` if no event
   * is due (or every due one is being claimed by another worker).
   */
  async claimDue(): Promise<WorkyScheduledEventRecord | null> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + CLAIM_LEASE_SECONDS * 1000);
    const claimed = await this.timers.claimDue(now, randomUUID());
    if (!claimed) return null;
    this.logger.debug('Worky scheduled event claimed', {
      id: claimed.id,
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
    event: WorkyScheduledEventRecord,
  ): Promise<'fired' | 'skipped_terminal' | 'skipped_already_fired'> {
    if (event.status === 'fired') return 'skipped_already_fired';
    if (event.status === 'canceled') return 'skipped_already_fired';
    if (event.taskId) {
      const task = await this.tasks.findById(event.taskId);
      if (task && (TERMINAL_TASK_STATES.has(task.executionState) || TERMINAL_TASK_LANES.has(task.lane))) {
        await this.timers.markFired(event.id, new Date());
        this.logger.log('Worky scheduled event skipped (task terminal)', {
          id: event.id,
          eventType: event.eventType,
        });
        return 'skipped_terminal';
      }
    }
    await this.timers.markFired(event.id, new Date());
    this.logger.log('Worky scheduled event fired', {
      id: event.id,
      eventType: event.eventType,
      streamId: event.streamId,
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
    const requeued = await this.timers.requeueExpired(leaseCutoff);
    if (requeued > 0) {
      this.logger.warn('Worky scheduled events re-queued by reconciler', {
        count: requeued,
      });
    }
    return requeued;
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
