import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { GovernanceDocument, GovernanceDocumentDocument } from './schemas/governance-document.schema';
import {
  GOVERNANCE_DOCUMENT_STORE,
  type GovernanceDocumentStore,
  type GovernanceDocumentUpdate,
  type GovernanceDocumentUpdateGuard,
  type GovernanceDocumentUpsertInput,
} from '../document-store';
import type { GovernanceDocumentRecord } from '../governance-records';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;

export function documentToRecord(doc: Row): GovernanceDocumentRecord {
  return {
    id: doc._id.toString(),
    programId: doc.programId.toString(),
    documentId: doc.documentId.toString(),
    workspaceId: doc.workspaceId.toString(),
    status: doc.status,
    validity: doc.validity,
    tags: doc.tags ?? [],
    metadata: doc.metadata ?? {},
    ownerUserId: doc.ownerUserId?.toString(),
    ownerScopeId: doc.ownerScopeId?.toString(),
    governanceRevision: doc.governanceRevision,
    temporalDecisionRevision: doc.temporalDecisionRevision,
    submittedForReviewBy: doc.submittedForReviewBy?.toString(),
    submittedForReviewAt: doc.submittedForReviewAt,
    reviewedBy: doc.reviewedBy?.toString(),
    reviewedAt: doc.reviewedAt,
    approvedBy: doc.approvedBy?.toString(),
    approvedAt: doc.approvedAt,
    publishedBy: doc.publishedBy?.toString(),
    publishedAt: doc.publishedAt,
    reviewComment: doc.reviewComment,
    archivedAt: doc.archivedAt,
    archivedBy: doc.archivedBy?.toString(),
    archiveReason: doc.archiveReason,
    lastIntegrationEventId: doc.lastIntegrationEventId,
    lastIntegrationEventAt: doc.lastIntegrationEventAt,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function objectIdOrNull(value: string | null | undefined): Types.ObjectId | undefined {
  return value ? new Types.ObjectId(value) : undefined;
}

function buildSet(update: GovernanceDocumentUpdate): Record<string, unknown> {
  const set: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(update.set)) if (value !== undefined) set[key] = value;
  for (const key of update.unset ?? []) delete set[key];
  return set;
}

@Injectable()
export class MongoGovernanceDocumentStore implements GovernanceDocumentStore {
  constructor(@InjectModel(GovernanceDocument.name) private readonly model: Model<GovernanceDocumentDocument>) {}

  async findByProgramAndDocumentId(programId: string, documentId: string): Promise<GovernanceDocumentRecord | null> {
    const found = await this.model.findOne({ programId: new Types.ObjectId(programId), documentId: new Types.ObjectId(documentId) }).exec();
    return found ? documentToRecord(found) : null;
  }

  async upsertFromWorkspace(input: GovernanceDocumentUpsertInput): Promise<GovernanceDocumentRecord> {
    const update = {
      $setOnInsert: {
        programId: new Types.ObjectId(input.programId),
        documentId: new Types.ObjectId(input.documentId),
        workspaceId: new Types.ObjectId(input.workspaceId),
        status: 'captured',
        validity: input.validity,
        tags: [],
        metadata: {},
        ownerUserId: objectIdOrNull(input.ownerUserId),
        ownerScopeId: objectIdOrNull(input.ownerScopeId),
        governanceRevision: 0,
        temporalDecisionRevision: 0,
      },
      $set: {
        workspaceId: new Types.ObjectId(input.workspaceId),
        ...(input.integrationEvent
          ? { lastIntegrationEventId: input.integrationEvent.id, lastIntegrationEventAt: input.integrationEvent.occurredAt }
          : {}),
      },
    };
    const governanceDocument = await this.model
      .findOneAndUpdate({ programId: new Types.ObjectId(input.programId), documentId: new Types.ObjectId(input.documentId) }, update, {
        new: true,
        upsert: true,
        setDefaultsOnInsert: true,
      })
      .exec();
    return documentToRecord(governanceDocument);
  }

  async listForProgramWorkspaces(programId: string, workspaceIds: string[], includeArchived: boolean): Promise<GovernanceDocumentRecord[]> {
    const records = await this.model
      .find({
        programId: new Types.ObjectId(programId),
        workspaceId: { $in: workspaceIds.map((id) => new Types.ObjectId(id)) },
        ...(includeArchived ? {} : { status: { $ne: 'archived' } }),
      })
      .sort({ updatedAt: -1 })
      .lean()
      .exec();
    return records.map(documentToRecord);
  }

  async findById(id: string): Promise<GovernanceDocumentRecord | null> {
    const found = await this.model.findById(id).exec();
    return found ? documentToRecord(found) : null;
  }

  async updateGuarded(id: string, guard: GovernanceDocumentUpdateGuard, update: GovernanceDocumentUpdate): Promise<GovernanceDocumentRecord | null> {
    const filter: Record<string, unknown> = { _id: new Types.ObjectId(id) };
    if (guard.governanceRevision !== undefined) filter.governanceRevision = guard.governanceRevision;
    if (guard.temporalDecisionRevision !== undefined) filter.temporalDecisionRevision = guard.temporalDecisionRevision;
    if (guard.statusEquals !== undefined) filter.status = guard.statusEquals;
    if (guard.statusNotEquals !== undefined) filter.status = { ...(filter.status as object), $ne: guard.statusNotEquals };
    const payload: Record<string, unknown> = { $set: buildSet(update) };
    if (update.bumpGovernanceRevision) payload.$inc = { ...(payload.$inc as object), governanceRevision: 1 };
    if (update.bumpTemporalDecisionRevision) payload.$inc = { ...(payload.$inc as object), temporalDecisionRevision: 1 };
    if (update.unset?.length) payload.$unset = Object.fromEntries(update.unset.map((key) => [key, '']));
    const updated = await this.model.findOneAndUpdate(filter, payload, { new: true }).exec();
    return updated ? documentToRecord(updated) : null;
  }

  async archiveFromWorkspaceDeletion(programId: string, documentId: string, actorId: string, event: { id: string; occurredAt: Date }): Promise<GovernanceDocumentRecord | null> {
    const record = await this.model
      .findOneAndUpdate(
        {
          programId: new Types.ObjectId(programId),
          documentId: new Types.ObjectId(documentId),
          status: { $ne: 'archived' },
          lastIntegrationEventId: { $ne: event.id },
        },
        {
          $set: {
            status: 'archived',
            archivedAt: event.occurredAt,
            archivedBy: new Types.ObjectId(actorId),
            archiveReason: 'Workspace document deleted',
            lastIntegrationEventId: event.id,
            lastIntegrationEventAt: event.occurredAt,
          },
          $inc: { governanceRevision: 1 },
        },
        { new: true },
      )
      .exec();
    return record ? documentToRecord(record) : null;
  }

  async deleteByIdGuarded(id: string, expectedGovernanceRevision: number): Promise<boolean> {
    const result = await this.model.deleteOne({ _id: new Types.ObjectId(id), governanceRevision: expectedGovernanceRevision, status: 'archived' }).exec();
    return result.deletedCount === 1;
  }

  async countByProgram(programId: string): Promise<number> {
    return this.model.countDocuments({ programId: new Types.ObjectId(programId) });
  }

  async listDueForReview(now: Date, limit: number): Promise<GovernanceDocumentRecord[]> {
    const due = await this.model
      .find({
        status: { $nin: ['rejected', 'archived'] },
        'validity.nextReviewAt': { $lte: now },
        'validity.businessStatus': { $nin: ['needs_review', 'expired', 'suspended', 'conflicting'] },
      })
      .sort({ 'validity.nextReviewAt': 1 })
      .limit(limit)
      .exec();
    return due.map(documentToRecord);
  }

  async markNeedsReviewIfUnchanged(id: string, previousBusinessStatus: string | undefined, _previousNextReviewAt: Date | undefined | null): Promise<boolean> {
    const updated = await this.model
      .updateOne(
        { _id: new Types.ObjectId(id), 'validity.businessStatus': previousBusinessStatus },
        { $set: { 'validity.businessStatus': 'needs_review' }, $inc: { governanceRevision: 1 } },
      )
      .exec();
    return updated.modifiedCount === 1;
  }

  async patchValidityForDocument(programId: string, documentId: string, patch: { nextReviewAt: Date; reviewFrequencyDays: number }): Promise<GovernanceDocumentRecord | null> {
    const updated = await this.model
      .findOneAndUpdate(
        { programId: new Types.ObjectId(programId), documentId: new Types.ObjectId(documentId), status: { $nin: ['rejected', 'archived'] } },
        {
          $set: { 'validity.nextReviewAt': patch.nextReviewAt, 'validity.reviewFrequencyDays': patch.reviewFrequencyDays },
          $inc: { governanceRevision: 1 },
        },
        { new: true },
      )
      .exec();
    return updated ? documentToRecord(updated) : null;
  }

  async setMetadataField(programId: string, documentId: string, key: string, value: unknown): Promise<GovernanceDocumentRecord | null> {
    const updated = await this.model
      .findOneAndUpdate(
        { programId: new Types.ObjectId(programId), documentId: new Types.ObjectId(documentId), status: { $nin: ['rejected', 'archived'] } },
        { $set: { [`metadata.${key}`]: value }, $inc: { governanceRevision: 1 } },
        { new: true },
      )
      .exec();
    return updated ? documentToRecord(updated) : null;
  }

  async listByIdCursor(programId: string, workspaceId: string, afterId: string | undefined, limit: number): Promise<GovernanceDocumentRecord[]> {
    const query: Record<string, unknown> = { programId: new Types.ObjectId(programId), workspaceId: new Types.ObjectId(workspaceId) };
    if (afterId) query._id = { $gt: new Types.ObjectId(afterId) };
    const records = await this.model.find(query).sort({ _id: 1 }).limit(limit).exec();
    return records.map(documentToRecord);
  }


  async listNonArchived(limit: number): Promise<GovernanceDocumentRecord[]> {
    const records = await this.model.find({ status: { $nin: ['rejected', 'archived'] } }).sort({ updatedAt: 1 }).limit(limit).exec();
    return records.map(documentToRecord);
  }

  async clearOwnerScope(programId: string, scopeId: string): Promise<void> {
    await this.model.updateMany({ programId: new Types.ObjectId(programId), ownerScopeId: new Types.ObjectId(scopeId) }, { $unset: { ownerScopeId: '' }, $inc: { governanceRevision: 1 } }).exec();
  }
}
