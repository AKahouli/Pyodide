import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import {
  WorkyIdempotencyRecord,
  WorkyIdempotencyRecordDocument,
} from '../schemas/worky-idempotency-record.schema';
import { LoggerService } from '../../logger';

export interface IdempotencyResult {
  firstSeen: boolean;
  replay: boolean;
  record: WorkyIdempotencyRecordDocument;
}

/**
 * `(streamId, eventId)` dedup primitive for every runtime → NestJS callback
 * (canonical §6.2). Concurrent inserters race on the unique compound index
 * declared in the schema; the loser gets a duplicate-key error and is
 * reported as a replay.
 *
 * The record is treated as the *first* delivery's source of truth. The
 * handler is free to ignore the replay payload and return the previously
 * computed ack (callers should not store any other idempotent state on the
 * record itself).
 */
@Injectable()
export class WorkyIdempotencyService {
  constructor(
    @InjectModel(WorkyIdempotencyRecord.name)
    private readonly model: Model<WorkyIdempotencyRecordDocument>,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyIdempotencyService.name);
  }

  async claim(streamId: string, eventId: string, callback: string): Promise<IdempotencyResult> {
    if (!Types.ObjectId.isValid(streamId)) {
      throw new Error(`WorkyIdempotencyService.claim: invalid streamId ${streamId}`);
    }
    if (!eventId || eventId.length > 128) {
      throw new Error('WorkyIdempotencyService.claim: eventId is required and must be ≤128 chars');
    }

    try {
      const record = await this.model.create({
        streamId: new Types.ObjectId(streamId),
        eventId,
        callback,
      });
      return { firstSeen: true, replay: false, record };
    } catch (error) {
      const code = (error as { code?: number }).code;
      if (code === 11000) {
        const existing = await this.model
          .findOne({ streamId: new Types.ObjectId(streamId), eventId })
          .exec();
        if (!existing) {
          // The duplicate-key error implies the row exists; the failed
          // re-read is unexpected. Surface as a generic failure rather
          // than silently treating it as a replay.
          throw new Error(
            `WorkyIdempotencyService.claim: duplicate-key but no record found for ${streamId}/${eventId}`,
          );
        }
        this.logger.warn('Idempotent replay detected', {
          streamId,
          eventId,
          callback,
        });
        return { firstSeen: false, replay: true, record: existing };
      }
      throw error;
    }
  }
}
