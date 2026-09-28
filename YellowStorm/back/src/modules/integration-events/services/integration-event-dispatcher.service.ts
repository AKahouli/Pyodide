import { Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { and, eq, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { randomUUID } from 'crypto';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { FeatureVisibilityService } from '@modules/system/feature-visibility.service';
import type { IntegrationEventEnvelope, IntegrationEventHandler } from '../interfaces/integration-event.interface';
import { IntegrationEventHandlerRegistryService } from './integration-event-handler-registry.service';

const events = schema.opsIntegrationEvents;
const deliveries = schema.opsIntegrationEventDeliveries;

const BATCH_SIZE = 50;
/** An event claimed longer ago than this is taken over: its dispatcher is presumed dead. */
const LOCK_TTL_MS = 120_000;
const MAX_ATTEMPTS = 10;
const MAX_BACKOFF_MS = 300_000;
const MAX_ERROR_LENGTH = 2000;

interface ClaimedEvent {
  id: string;
  attempts: number;
  envelope: IntegrationEventEnvelope;
}

/**
 * Claims pending outbox events one at a time and delivers each to every handler registered for its type.
 * A handler that already completed for an event is not run again; a claim held by a dead dispatcher is
 * taken over after LOCK_TTL_MS. Every write after the claim is fenced on the lock owner.
 */
@Injectable()
export class IntegrationEventDispatcherService {
  private readonly instanceId = randomUUID();

  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly registry: IntegrationEventHandlerRegistryService,
    private readonly features: FeatureVisibilityService,
  ) {}

  @Cron(CronExpression.EVERY_5_SECONDS)
  async dispatch(): Promise<void> {
    if (!this.features.isEnabled('dataRoomOutboxDispatch')) return;
    for (let i = 0; i < BATCH_SIZE; i += 1) {
      const event = await this.claimNext();
      if (!event) return;
      await this.process(event);
    }
  }

  private async process(event: ClaimedEvent): Promise<void> {
    const handlers = this.registry.forType(event.envelope.eventType);
    const known = await this.db.select().from(deliveries).where(eq(deliveries.integrationEventId, event.id));
    const outcomes = await Promise.all(handlers.map((handler) => this.deliver(event, handler)));
    const registered = new Set(handlers.map((handler) => handler.handlerKey));
    const unavailableDelivery = known.some((delivery) => delivery.status !== 'completed' && !registered.has(delivery.handlerKey));
    const failed = unavailableDelivery || outcomes.some((outcome) => !outcome);
    const now = new Date();
    const fenced = and(eq(events.id, event.id), eq(events.lockOwner, this.instanceId));
    if (failed) {
      await this.db
        .update(events)
        .set({
          status: event.attempts < MAX_ATTEMPTS ? 'failed' : 'dead_letter',
          lastError: unavailableDelivery ? 'A previously failing integration-event handler is unavailable' : 'One or more integration-event handlers failed',
          nextAttemptAt: new Date(now.getTime() + Math.min(MAX_BACKOFF_MS, 1000 * 2 ** event.attempts)),
          lockedAt: null,
          lockOwner: null,
          updatedAt: now,
        })
        .where(fenced);
    } else {
      await this.db
        .update(events)
        .set({ status: 'completed', processedAt: now, lockedAt: null, lockOwner: null, lastError: null, updatedAt: now })
        .where(fenced);
    }
  }

  private async deliver(event: ClaimedEvent, handler: IntegrationEventHandler): Promise<boolean> {
    const [done] = await this.db
      .select({ status: deliveries.status })
      .from(deliveries)
      .where(and(eq(deliveries.integrationEventId, event.id), eq(deliveries.handlerKey, handler.handlerKey), eq(deliveries.status, 'completed')))
      .limit(1);
    if (done) return true;

    // Only the dispatcher that holds the claim may open a delivery.
    await this.db.execute(sql`
      INSERT INTO ops.integration_event_deliveries (integration_event_id, handler_key, status, attempts)
      SELECT ${event.id}, ${handler.handlerKey}, 'pending', 0
      WHERE EXISTS (SELECT 1 FROM ops.integration_events WHERE id = ${event.id} AND lock_owner = ${this.instanceId})
      ON CONFLICT (integration_event_id, handler_key) DO NOTHING
    `);
    try {
      await handler.handle(event.envelope);
      await this.settle(event.id, handler.handlerKey, 'completed', null);
      return true;
    } catch (error) {
      await this.settle(event.id, handler.handlerKey, 'failed', error instanceof Error ? error.message.slice(0, MAX_ERROR_LENGTH) : 'Unknown error');
      return false;
    }
  }

  /** Records a handler's outcome, unless the claim has been taken over meanwhile. */
  private async settle(eventId: string, handlerKey: string, status: 'completed' | 'failed', error: string | null): Promise<void> {
    await this.db.execute(sql`
      UPDATE ops.integration_event_deliveries d
      SET status = ${status},
          attempts = d.attempts + 1,
          last_error = ${error},
          completed_at = CASE WHEN ${status} = 'completed' THEN now() ELSE d.completed_at END
      FROM ops.integration_events e
      WHERE d.integration_event_id = e.id AND e.id = ${eventId} AND e.lock_owner = ${this.instanceId} AND d.handler_key = ${handlerKey}
    `);
  }

  /**
   * Takes the oldest due event: pending or failed ones whose retry time has come, plus any whose claim
   * expired (a dispatcher that died mid-delivery). SKIP LOCKED lets concurrent dispatchers claim
   * different events instead of waiting on each other.
   */
  private async claimNext(): Promise<ClaimedEvent | null> {
    const now = new Date();
    const expired = new Date(now.getTime() - LOCK_TTL_MS);
    const [row] = await this.db
      .update(events)
      .set({ status: 'processing', lockedAt: now, lockOwner: this.instanceId, attempts: sql`${events.attempts} + 1`, updatedAt: now })
      .where(sql`${events.id} = (
        SELECT c.id FROM ops.integration_events c
        WHERE c.next_attempt_at <= ${now}
          AND ((c.status IN ('pending', 'failed') AND (c.locked_at IS NULL OR c.locked_at < ${expired}))
            OR (c.status = 'processing' AND c.locked_at < ${expired}))
        ORDER BY c.next_attempt_at, c.id
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )`)
      .returning();
    if (!row) return null;
    return {
      id: row.id,
      attempts: row.attempts,
      envelope: {
        eventId: row.eventId,
        eventType: row.eventType,
        aggregateType: row.aggregateType,
        aggregateId: row.aggregateId,
        payload: row.payload,
        occurredAt: row.occurredAt,
        ...(row.correlationId ? { correlationId: row.correlationId } : {}),
        ...(row.causationId ? { causationId: row.causationId } : {}),
      },
    };
  }
}
