import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { GovernanceDocumentEvent, GovernanceDocumentEventDocument, GovernanceDocumentEventType } from '../schemas/governance-document-event.schema';

export interface AppendGovernanceDocumentEventInput {
  programId: string;
  governanceDocumentId: string;
  documentId: string;
  eventType: GovernanceDocumentEventType;
  actorId?: string;
  actorEmail?: string;
  actorType?: 'user' | 'system' | 'integration';
  reason?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
  correlationId?: string;
  causationId?: string;
  deduplicationKey?: string;
  session?: ClientSession;
}

@Injectable()
export class GovernanceDocumentEventService {
  constructor(@InjectModel(GovernanceDocumentEvent.name) private readonly model: Model<GovernanceDocumentEventDocument>) {}

  async append(input: AppendGovernanceDocumentEventInput): Promise<GovernanceDocumentEventDocument> {
    const { session, ...values } = input;
    const payload = {
      ...values,
      programId: new Types.ObjectId(input.programId),
      governanceDocumentId: new Types.ObjectId(input.governanceDocumentId),
      documentId: new Types.ObjectId(input.documentId),
      actorId: input.actorId ? new Types.ObjectId(input.actorId) : undefined,
      actorType: input.actorType ?? (input.actorId ? 'user' : 'system'),
      occurredAt: input.occurredAt ?? new Date(),
      metadata: input.metadata ?? {},
    };
    try {
      if (session) return (await this.model.create([payload], { session }))[0];
      return await this.model.create(payload);
    } catch (error) {
      if (input.deduplicationKey && typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000) {
        const existing = await this.model.findOne({ governanceDocumentId: payload.governanceDocumentId, deduplicationKey: input.deduplicationKey }).exec();
        if (existing) return existing;
      }
      throw error;
    }
  }

  async findByDeduplicationKey(governanceDocumentId: string, key: string): Promise<GovernanceDocumentEventDocument | null> {
    return this.model.findOne({ governanceDocumentId: new Types.ObjectId(governanceDocumentId), deduplicationKey: key }).exec();
  }

  async list(governanceDocumentId: string): Promise<GovernanceDocumentEventDocument[]> {
    return this.model.find({ governanceDocumentId: new Types.ObjectId(governanceDocumentId) }).sort({ occurredAt: -1 }).exec();
  }
}
