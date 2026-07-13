import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { GovernanceSourceEvent, GovernanceSourceEventDocument, GovernanceSourceEventType } from '../schemas/governance-source-event.schema';

@Injectable()
export class GovernanceSourceEventService {
  constructor(@InjectModel(GovernanceSourceEvent.name) private readonly eventModel: Model<GovernanceSourceEventDocument>) {}
  async append(input: { programId: string; sourceId: string; versionId?: string; eventType: GovernanceSourceEventType; actorId?: string; actorEmail?: string; actorType?: 'user' | 'system' | 'integration'; reason?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown>; occurredAt?: Date; correlationId?: string; causationId?: string; deduplicationKey?: string; session?: ClientSession }): Promise<GovernanceSourceEventDocument> {
    const { session, ...eventInput } = input;
    const payload = { ...eventInput, programId: new Types.ObjectId(input.programId), sourceId: new Types.ObjectId(input.sourceId), versionId: input.versionId ? new Types.ObjectId(input.versionId) : undefined, actorId: input.actorId ? new Types.ObjectId(input.actorId) : undefined, actorType: input.actorType ?? (input.actorId ? 'user' : 'system'), occurredAt: input.occurredAt ?? new Date(), metadata: input.metadata ?? {} };
    try {
      if (session) {
        const [created] = await this.eventModel.create([payload], { session });
        return created;
      }
      return await this.eventModel.create(payload);
    }
    catch (error) {
      if (input.deduplicationKey && typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000) {
        const existing = await this.eventModel.findOne({ sourceId: payload.sourceId, deduplicationKey: input.deduplicationKey }).exec();
        if (existing) return existing;
      }
      throw error;
    }
  }
  async findByDeduplicationKey(sourceId: string, deduplicationKey: string): Promise<GovernanceSourceEventDocument | null> { return this.eventModel.findOne({ sourceId: new Types.ObjectId(sourceId), deduplicationKey }).exec(); }
  async list(sourceId: string): Promise<GovernanceSourceEventDocument[]> { return this.eventModel.find({ sourceId: new Types.ObjectId(sourceId) }).sort({ occurredAt: -1 }).exec(); }
}
