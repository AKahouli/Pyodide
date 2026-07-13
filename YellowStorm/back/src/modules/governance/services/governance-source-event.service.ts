import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GovernanceSourceEvent, GovernanceSourceEventDocument, GovernanceSourceEventType } from '../schemas/governance-source-event.schema';

@Injectable()
export class GovernanceSourceEventService {
  constructor(@InjectModel(GovernanceSourceEvent.name) private readonly eventModel: Model<GovernanceSourceEventDocument>) {}
  async append(input: { programId: string; sourceId: string; versionId?: string; eventType: GovernanceSourceEventType; actorId?: string; reason?: string; before?: Record<string, unknown>; after?: Record<string, unknown>; metadata?: Record<string, unknown> }): Promise<GovernanceSourceEventDocument> {
    return this.eventModel.create({ ...input, programId: new Types.ObjectId(input.programId), sourceId: new Types.ObjectId(input.sourceId), versionId: input.versionId ? new Types.ObjectId(input.versionId) : undefined, actorId: input.actorId ? new Types.ObjectId(input.actorId) : undefined, occurredAt: new Date(), metadata: input.metadata ?? {} });
  }
  async list(sourceId: string): Promise<GovernanceSourceEventDocument[]> { return this.eventModel.find({ sourceId: new Types.ObjectId(sourceId) }).sort({ occurredAt: -1 }).exec(); }
}
