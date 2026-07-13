import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'crypto';
import { IntegrationEvent, IntegrationEventDocument } from '../schemas/integration-event.schema';
import { IntegrationEventHandlerRegistryService } from './integration-event-handler-registry.service';
@Injectable()
export class IntegrationEventDispatcherService {
  private readonly instanceId = randomUUID();
  constructor(@InjectModel(IntegrationEvent.name) private readonly eventModel: Model<IntegrationEventDocument>, private readonly registry: IntegrationEventHandlerRegistryService, private readonly config: ConfigService) {}
  @Cron(CronExpression.EVERY_5_SECONDS)
  async dispatch(): Promise<void> { if (!this.config.get<boolean>('dataRoom.outboxDispatchEnabled')) return; for (let i = 0; i < 50; i += 1) { const event = await this.lockNext(); if (!event) return; try { await Promise.all(this.registry.forType(event.eventType).map((handler) => handler.handle(event.toObject()))); await this.eventModel.updateOne({ _id: event._id, lockOwner: this.instanceId }, { $set: { status: 'completed', processedAt: new Date(), lockedAt: null, lockOwner: null, lastError: null } }).exec(); } catch (error) { const retry = event.attempts < 10; await this.eventModel.updateOne({ _id: event._id, lockOwner: this.instanceId }, { $set: { status: retry ? 'failed' : 'dead_letter', lastError: error instanceof Error ? error.message.slice(0, 2000) : 'Unknown error', nextAttemptAt: new Date(Date.now() + Math.min(300000, 1000 * 2 ** event.attempts)), lockedAt: null, lockOwner: null } }).exec(); } } }
  private async lockNext(): Promise<IntegrationEventDocument | null> { const now = new Date(); return this.eventModel.findOneAndUpdate({ status: { $in: ['pending', 'failed'] }, nextAttemptAt: { $lte: now }, $or: [{ lockedAt: { $exists: false } }, { lockedAt: null }, { lockedAt: { $lt: new Date(now.getTime() - 120000) } }] }, { $set: { status: 'processing', lockedAt: now, lockOwner: this.instanceId }, $inc: { attempts: 1 } }, { new: true }).exec(); }
}
