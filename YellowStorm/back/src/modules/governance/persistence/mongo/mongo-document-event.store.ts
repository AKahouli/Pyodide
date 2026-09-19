import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GovernanceDocumentEvent, GovernanceDocumentEventDocument } from './schemas/governance-document-event.schema';
import { GOVERNANCE_EVENT_STORE, type AppendGovernanceDocumentEventInput, type GovernanceEventStore } from '../document-event-store';
import type { GovernanceDocumentEventRecord } from '../governance-records';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export function eventToRecord(doc: Row): GovernanceDocumentEventRecord {
  return {
    id: doc._id.toString(),
    programId: doc.programId.toString(),
    governanceDocumentId: doc.governanceDocumentId.toString(),
    documentId: doc.documentId.toString(),
    eventType: doc.eventType,
    actorId: doc.actorId?.toString(),
    actorType: doc.actorType,
    actorEmail: doc.actorEmail,
    occurredAt: doc.occurredAt,
    reason: doc.reason,
    before: doc.before,
    after: doc.after,
    metadata: doc.metadata ?? {},
    correlationId: doc.correlationId,
    causationId: doc.causationId,
    deduplicationKey: doc.deduplicationKey,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

@Injectable()
export class MongoGovernanceEventStore implements GovernanceEventStore {
  constructor(@InjectModel(GovernanceDocumentEvent.name) private readonly model: Model<GovernanceDocumentEventDocument>) {}

  async append(input: AppendGovernanceDocumentEventInput): Promise<GovernanceDocumentEventRecord> {
    const payload = {
      ...input,
      programId: new Types.ObjectId(input.programId),
      governanceDocumentId: new Types.ObjectId(input.governanceDocumentId),
      documentId: new Types.ObjectId(input.documentId),
      actorId: input.actorId ? new Types.ObjectId(input.actorId) : undefined,
      actorType: input.actorType ?? (input.actorId ? 'user' : 'system'),
      occurredAt: input.occurredAt ?? new Date(),
      metadata: input.metadata ?? {},
    };
    try {
      return eventToRecord(await this.model.create(payload));
    } catch (error) {
      if (input.deduplicationKey && typeof error === 'object' && error !== null && 'code' in error && (error as { code?: number }).code === 11000) {
        const existing = await this.findByDeduplicationKey(input.governanceDocumentId, input.deduplicationKey);
        if (existing) return existing;
      }
      throw error;
    }
  }

  async findByDeduplicationKey(governanceDocumentId: string, key: string): Promise<GovernanceDocumentEventRecord | null> {
    const found = await this.model.findOne({ governanceDocumentId: new Types.ObjectId(governanceDocumentId), deduplicationKey: key }).exec();
    return found ? eventToRecord(found) : null;
  }

  async listByGovernanceDocument(governanceDocumentId: string): Promise<GovernanceDocumentEventRecord[]> {
    const events = await this.model.find({ governanceDocumentId: new Types.ObjectId(governanceDocumentId) }).sort({ occurredAt: -1 }).exec();
    return events.map(eventToRecord);
  }
}
