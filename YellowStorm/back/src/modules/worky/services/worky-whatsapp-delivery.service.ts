import { forwardRef, Inject, Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { randomUUID } from 'node:crypto';
import { Model, Types } from 'mongoose';
import { LoggerService } from '../../logger';
import { WorkyWhatsAppConnectionService } from '../../whatsapp/services/worky-whatsapp-connection.service';
import { WorkyMessage, WorkyMessageDocument } from '../schemas/worky-message.schema';

@Injectable()
export class WorkyWhatsAppDeliveryService {
  private static readonly LEASE_MS = 5 * 60_000;
  private static readonly SEND_TIMEOUT_MS = 30_000;
  private draining = false;

  constructor(
    @InjectModel(WorkyMessage.name)
    private readonly messages: Model<WorkyMessageDocument>,
    @Inject(forwardRef(() => WorkyWhatsAppConnectionService))
    private readonly whatsapp: WorkyWhatsAppConnectionService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyWhatsAppDeliveryService.name);
  }

  async attempt(messageId: Types.ObjectId | string): Promise<void> {
    const claimed = await this.claim({ _id: messageId });
    if (claimed) await this.deliver(claimed);
  }

  @Cron(CronExpression.EVERY_10_SECONDS)
  async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      for (let count = 0; count < 25; count += 1) {
        const claimed = await this.claim({});
        if (!claimed) break;
        await this.deliver(claimed);
      }
    } finally {
      this.draining = false;
    }
  }

  private async claim(extraFilter: Record<string, unknown>): Promise<WorkyMessageDocument | null> {
    const now = new Date();
    const leaseToken = randomUUID();
    return this.messages
      .findOneAndUpdate(
        {
          ...extraFilter,
          role: 'manager',
          $or: [
            {
              'whatsappDelivery.status': { $in: ['pending', 'failed'] },
              'whatsappDelivery.nextAttemptAt': { $lte: now },
            },
            {
              'whatsappDelivery.status': 'processing',
              'whatsappDelivery.leaseExpiresAt': { $lte: now },
            },
          ],
        },
        {
          $set: {
            'whatsappDelivery.status': 'processing',
            'whatsappDelivery.leaseToken': leaseToken,
            'whatsappDelivery.leaseExpiresAt': new Date(now.getTime() + WorkyWhatsAppDeliveryService.LEASE_MS),
          },
          $inc: { 'whatsappDelivery.attempts': 1 },
        },
        { new: true, sort: { 'whatsappDelivery.nextAttemptAt': 1, createdAt: 1 } },
      )
      .exec();
  }

  private async deliver(message: WorkyMessageDocument): Promise<void> {
    const token = message.whatsappDelivery?.leaseToken;
    if (!token) return;
    const filter = {
      _id: message._id,
      'whatsappDelivery.status': 'processing',
      'whatsappDelivery.leaseToken': token,
    };
    try {
      const outcome = await this.forwardWithTimeout(
        message.streamId.toString(),
        message.content,
      );
      const status = outcome === 'not_configured' ? 'skipped' : 'delivered';
      await this.messages.updateOne(filter, {
        $set: {
          'whatsappDelivery.status': status,
          'whatsappDelivery.deliveredAt': status === 'delivered' ? new Date() : null,
          'whatsappDelivery.nextAttemptAt': null,
          'whatsappDelivery.leaseToken': null,
          'whatsappDelivery.leaseExpiresAt': null,
          'whatsappDelivery.lastError': null,
        },
      }).exec();
    } catch (error) {
      const attempts = message.whatsappDelivery?.attempts ?? 1;
      const delayMs = Math.min(5 * 60_000, 1_000 * 2 ** Math.min(attempts - 1, 8));
      const errorMessage = error instanceof Error ? error.message : String(error);
      await this.messages.updateOne(filter, {
        $set: {
          'whatsappDelivery.status': 'failed',
          'whatsappDelivery.nextAttemptAt': new Date(Date.now() + delayMs),
          'whatsappDelivery.leaseToken': null,
          'whatsappDelivery.leaseExpiresAt': null,
          'whatsappDelivery.lastError': errorMessage.slice(0, 500),
        },
      }).exec();
      this.logger.warn('Worky WhatsApp delivery failed; retry scheduled', {
        messageId: message._id.toString(),
        streamId: message.streamId.toString(),
        attempts,
        error: errorMessage,
      });
    }
  }

  private async forwardWithTimeout(
    streamId: string,
    content: string,
  ): Promise<'sent' | 'not_configured'> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Worky WhatsApp delivery timed out')),
        WorkyWhatsAppDeliveryService.SEND_TIMEOUT_MS,
      );
      void this.whatsapp.forwardManagerMessage(streamId, content).then(
        (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        (error) => {
          clearTimeout(timer);
          reject(error);
        },
      );
    });
  }
}
