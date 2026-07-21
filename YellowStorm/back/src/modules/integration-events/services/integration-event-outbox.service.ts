import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggerService } from '@modules/logger';
import { IntegrationEvent, IntegrationEventDocument } from '../schemas/integration-event.schema';
import type { NewIntegrationEvent } from '../interfaces/integration-event.interface';
@Injectable()
export class IntegrationEventOutboxService {
  constructor(@InjectModel(IntegrationEvent.name) private readonly eventModel: Model<IntegrationEventDocument>, private readonly logger: LoggerService) { this.logger.setContext(IntegrationEventOutboxService.name); }
  async record(event: NewIntegrationEvent): Promise<void> { if (Buffer.byteLength(JSON.stringify(event.payload), 'utf8') > 64 * 1024) throw new Error('Integration event payload is too large'); try { await this.eventModel.create({ ...event, occurredAt: event.occurredAt ?? new Date(), nextAttemptAt: new Date() }); } catch (error) { if (!(typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000)) throw error; } this.logger.debug('Integration event recorded', { eventId: event.eventId, eventType: event.eventType, aggregateId: event.aggregateId, correlationId: event.correlationId }); }
  async recordMany(events: NewIntegrationEvent[]): Promise<void> { for (const event of events) await this.record(event); }
}
