import { Inject, Injectable } from '@nestjs/common';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { newObjectId, stripNul } from '@common/postgres';
import { resolveQueryable, type PgQueryable } from '@common/postgres/transaction';
import { DRIZZLE_DB } from '@modules/postgres/postgres.constants';
import * as schema from '@modules/postgres/schema';
import { LoggerService } from '@modules/logger';
import type { NewIntegrationEvent } from '../interfaces/integration-event.interface';

const MAX_PAYLOAD_BYTES = 64 * 1024;

/**
 * Transactional outbox: `record` runs in the caller's transaction when there is one, so an event exists
 * exactly when the change it announces was committed. Recording the same `eventId` twice is a no-op.
 */
@Injectable()
export class IntegrationEventOutboxService {
  constructor(
    @Inject(DRIZZLE_DB) private readonly db: NodePgDatabase<typeof schema>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(IntegrationEventOutboxService.name);
  }

  private get q(): PgQueryable<typeof schema> {
    return resolveQueryable(this.db);
  }

  async record(event: NewIntegrationEvent): Promise<void> {
    if (Buffer.byteLength(JSON.stringify(event.payload), 'utf8') > MAX_PAYLOAD_BYTES) throw new Error('Integration event payload is too large');
    await this.q
      .insert(schema.opsIntegrationEvents)
      .values({
        id: newObjectId(),
        eventId: event.eventId,
        eventType: event.eventType,
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        payload: stripNul(event.payload),
        occurredAt: event.occurredAt ?? new Date(),
        nextAttemptAt: new Date(),
        correlationId: event.correlationId ?? null,
        causationId: event.causationId ?? null,
      })
      .onConflictDoNothing({ target: schema.opsIntegrationEvents.eventId });
    this.logger.debug('Integration event recorded', {
      eventId: event.eventId,
      eventType: event.eventType,
      aggregateId: event.aggregateId,
      correlationId: event.correlationId,
    });
  }

  async recordMany(events: NewIntegrationEvent[]): Promise<void> {
    for (const event of events) await this.record(event);
  }
}
