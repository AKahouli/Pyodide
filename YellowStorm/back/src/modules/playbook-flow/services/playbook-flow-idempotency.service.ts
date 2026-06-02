import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';
import { ErrorCode } from '../../exceptions/constants/error-codes';
import {
  ConflictException,
} from '../../exceptions/exceptions/http.exceptions';
import {
  FlowIdempotencyRecord,
  FlowIdempotencyRecordDocument,
} from '../schemas/playbook-flow-idempotency-record.schema';

@Injectable()
export class PlaybookFlowIdempotencyService {
  private readonly logger = new Logger(PlaybookFlowIdempotencyService.name);
  private readonly ttlHours: number;

  constructor(
    @InjectModel(FlowIdempotencyRecord.name)
    private readonly idempotencyModel: Model<FlowIdempotencyRecordDocument>,
    private readonly configService: ConfigService,
  ) {
    this.ttlHours = this.configService.get<number>('playbook-flow.idempotencyTtlHours', 24);
  }

  private createPayloadHash(body: unknown): string {
    const normalized = this.sortKeysDeep(body);
    return crypto.createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }

  private sortKeysDeep(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map((item) => this.sortKeysDeep(item));
    const sorted = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    const result: Record<string, unknown> = {};
    for (const [key, val] of sorted) {
      result[key] = this.sortKeysDeep(val);
    }
    return result;
  }

  /**
   * Atomically reserve an idempotency key. The unique index on (ownerId, idempotencyKey)
   * guarantees only one caller wins.
   *
   * Returns:
   *   - { type: 'reserved' } — caller should create the execution, then call confirmLink()
   *   - { type: 'duplicate', executionId } — same key + same payload, return existing execution
   *   - throws ConflictException — same key + different payload
   */
  async reserve(
    ownerId: string,
    idempotencyKey: string,
    body: unknown,
  ): Promise<{ type: 'reserved' } | { type: 'duplicate'; executionId: string }> {
    const payloadHash = this.createPayloadHash(body);
    const expiresAt = new Date(Date.now() + this.ttlHours * 60 * 60 * 1000);

    try {
      await this.idempotencyModel.create({
        ownerId,
        idempotencyKey,
        payloadHash,
        expiresAt,
      });
      return { type: 'reserved' };
    } catch (err: any) {
      if (err.code === 11000) {
        const existing = await this.idempotencyModel.findOne({
          ownerId,
          idempotencyKey,
        }).lean();

        if (!existing) {
          this.logger.warn(`Idempotency record disappeared for key ${idempotencyKey}, retrying as reserved`);
          return this.reserve(ownerId, idempotencyKey, body);
        }

        if (existing.payloadHash === payloadHash) {
          if (existing.executionId) {
            return { type: 'duplicate', executionId: existing.executionId };
          }
          this.logger.warn(
            `Idempotency key ${idempotencyKey} exists without executionId, previous creation may have failed`,
          );
          throw new ConflictException(
            ErrorCode.CONFLICT,
            'Idempotency key reservation exists but execution was not created. Retry with the same key and payload.',
          );
        }

        throw new ConflictException(
          ErrorCode.CONFLICT,
          'Idempotency key already used with different input. Use a new key or retry with matching input.',
        );
      }
      throw err;
    }
  }

  async reserveSave<T>(
    ownerId: string,
    idempotencyKey: string,
    body: unknown,
  ): Promise<
    | { type: 'reserved' }
    | { type: 'duplicate'; responseBody: T }
    | { type: 'duplicate-pending'; expectedStateHash?: string; expectedDefinitionRevision?: number }
  > {
    const payloadHash = this.createPayloadHash(body);
    const expiresAt = new Date(Date.now() + this.ttlHours * 60 * 60 * 1000);

    try {
      await this.idempotencyModel.create({
        ownerId,
        idempotencyKey,
        payloadHash,
        expiresAt,
      });
      return { type: 'reserved' };
    } catch (err: any) {
      if (err.code !== 11000) {
        throw err;
      }

      const existing = await this.idempotencyModel.findOne({ ownerId, idempotencyKey }).lean();
      if (!existing) {
        this.logger.warn(`Idempotency record disappeared for key ${idempotencyKey}, retrying as reserved`);
        return this.reserveSave(ownerId, idempotencyKey, body);
      }

      if (existing.payloadHash !== payloadHash) {
        throw new ConflictException(
          ErrorCode.CONFLICT,
          'Idempotency key already used with different input. Use a new key or retry with matching input.',
        );
      }

      if (existing.responseBody) {
        return { type: 'duplicate', responseBody: existing.responseBody as T };
      }

      return {
        type: 'duplicate-pending',
        expectedStateHash: existing.expectedStateHash,
        expectedDefinitionRevision: existing.expectedDefinitionRevision,
      };
    }
  }

  /**
   * Link the reserved idempotency record to the real execution id after execution creation.
   */
  async confirmLink(ownerId: string, idempotencyKey: string, executionId: string): Promise<void> {
    await this.idempotencyModel.updateOne(
      { ownerId, idempotencyKey },
      { $set: { executionId } },
    ).exec();
  }

  async confirmSaveResult(ownerId: string, idempotencyKey: string, responseBody: unknown): Promise<void> {
    await this.idempotencyModel.updateOne(
      { ownerId, idempotencyKey },
      { $set: { responseBody } },
    ).exec();
  }

  async recordExpectedSaveState(
    ownerId: string,
    idempotencyKey: string,
    expectedStateHash: string,
    expectedDefinitionRevision: number,
  ): Promise<void> {
    await this.idempotencyModel.updateOne(
      { ownerId, idempotencyKey },
      { $set: { expectedStateHash, expectedDefinitionRevision } },
    ).exec();
  }

  /**
   * Clean up the idempotency record if execution creation fails after reserve().
   */
  async release(ownerId: string, idempotencyKey: string): Promise<void> {
    await this.idempotencyModel.deleteOne({ ownerId, idempotencyKey }).exec();
  }
}
