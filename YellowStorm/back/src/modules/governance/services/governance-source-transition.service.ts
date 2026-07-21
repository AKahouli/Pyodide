import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { GovernanceSource, GovernanceSourceDocument } from '../schemas/governance-source.schema';
import { GovernanceSourceVersion, GovernanceSourceVersionDocument, type GovernanceSourceVersionLifecycleStatus } from '../schemas/governance-source-version.schema';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceSourceEventService } from './governance-source-event.service';

const transitions: Record<GovernanceSourceVersionLifecycleStatus, GovernanceSourceVersionLifecycleStatus[]> = { captured: ['to_review', 'rejected'], to_review: ['approved', 'rejected', 'captured'], approved: ['published', 'rejected'], published: ['superseded'], rejected: [], superseded: [] };
export interface SourceVersionTransitionCommand { commandId: string; actorId: string; actorEmail?: string; programId: string; sourceId: string; versionId: string; target: GovernanceSourceVersionLifecycleStatus; comment?: string; correlationId?: string; }

@Injectable()
export class GovernanceSourceTransitionService {
  private readonly logger = new Logger(GovernanceSourceTransitionService.name);
  constructor(@InjectModel(GovernanceSource.name) private readonly sourceModel: Model<GovernanceSourceDocument>, @InjectModel(GovernanceSourceVersion.name) private readonly versionModel: Model<GovernanceSourceVersionDocument>, private readonly access: GovernanceAccessService, private readonly events: GovernanceSourceEventService, @InjectConnection() private readonly connection: Connection) {}

  async transition(command: SourceVersionTransitionCommand): Promise<GovernanceSourceVersionDocument> {
    const duplicate = await this.events.findByDeduplicationKey(command.sourceId, this.deduplicationKey(command));
    if (duplicate?.versionId) return this.findVersion(command, duplicate.versionId.toString());
    await this.assertAccess(command);
    const session = await this.connection.startSession();
    try {
      let result: GovernanceSourceVersionDocument | undefined;
      await session.withTransaction(async () => { result = await this.performTransition(command, session); });
      if (!result) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Source-version transition did not complete');
      return result;
    } catch (error) {
      if (!this.isTransactionUnavailable(error)) throw error;
      this.logger.error('MongoDB transactions are unavailable; applying guarded source-version transition fallback', { sourceId: command.sourceId, versionId: command.versionId, commandId: command.commandId });
      return this.performTransition(command);
    } finally { await session.endSession(); }
  }

  private async performTransition(command: SourceVersionTransitionCommand, session?: ClientSession): Promise<GovernanceSourceVersionDocument> {
    const source = await this.sourceModel.findOne({ _id: new Types.ObjectId(command.sourceId), programId: new Types.ObjectId(command.programId) }, null, { session }).exec();
    const version = await this.versionModel.findOne({ _id: new Types.ObjectId(command.versionId), sourceId: new Types.ObjectId(command.sourceId), programId: new Types.ObjectId(command.programId) }, null, { session }).exec();
    if (!source || !version) throw new BadRequestException(ErrorCode.GOVERNANCE_SOURCE_NOT_FOUND);
    if (source.isArchived) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Archived sources cannot change lifecycle state');
    if (!transitions[version.lifecycleStatus].includes(command.target)) {
      const duplicate = await this.events.findByDeduplicationKey(command.sourceId, this.deduplicationKey(command));
      if (duplicate?.versionId) return this.findVersion(command, duplicate.versionId.toString());
      throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid source-version lifecycle transition');
    }
    if (command.target === 'published' && version.technicalStatus !== 'ready') throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'A source version must be technically ready before publication');
    const before = version.lifecycleStatus;
    const previousPublishedId = source.currentPublishedVersionId;
    const previousCandidateId = source.currentCandidateVersionId;
    const previousSourceStatus = source.status;
    const previousReviewComment = version.reviewComment;
    const previousAuditFields: Record<string, unknown> = { submittedForReviewBy: version.submittedForReviewBy, submittedForReviewAt: version.submittedForReviewAt, reviewedBy: version.reviewedBy, reviewedAt: version.reviewedAt, approvedBy: version.approvedBy, approvedAt: version.approvedAt, publishedBy: version.publishedBy, publishedAt: version.publishedAt };
    const now = new Date();
    const versionUpdate: Record<string, unknown> = { lifecycleStatus: command.target, reviewComment: command.comment };
    if (command.target === 'to_review') { versionUpdate.submittedForReviewBy = new Types.ObjectId(command.actorId); versionUpdate.submittedForReviewAt = now; }
    if (command.target === 'approved') { versionUpdate.reviewedBy = new Types.ObjectId(command.actorId); versionUpdate.reviewedAt = now; versionUpdate.approvedBy = new Types.ObjectId(command.actorId); versionUpdate.approvedAt = now; }
    if (command.target === 'published') {
      versionUpdate.publishedBy = new Types.ObjectId(command.actorId);
      versionUpdate.publishedAt = now;
    }
    const candidateWrite = await this.versionModel.updateOne({ _id: version._id, lifecycleStatus: before }, { $set: versionUpdate }, { session }).exec();
    if (candidateWrite.modifiedCount !== 1) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Source-version lifecycle changed concurrently');
    Object.assign(version, versionUpdate);

    if (command.target === 'published') {
      if (previousPublishedId) await this.versionModel.updateOne({ _id: previousPublishedId, lifecycleStatus: 'published' }, { $set: { lifecycleStatus: 'superseded' } }, { session }).exec();
      const sourceFilter = previousPublishedId
        ? { _id: source._id, currentPublishedVersionId: previousPublishedId }
        : { _id: source._id, currentPublishedVersionId: { $exists: false } };
      const sourceUpdate = source.currentCandidateVersionId?.equals(version._id)
        ? { $set: { currentPublishedVersionId: version._id, status: 'published' }, $unset: { currentCandidateVersionId: 1 } }
        : { $set: { currentPublishedVersionId: version._id, status: 'published' } };
      const sourceWrite = await this.sourceModel.updateOne(sourceFilter, sourceUpdate, { session }).exec();
      if (sourceWrite.modifiedCount !== 1) {
        if (!session) await this.compensateFailedFallback(command, source, before, previousPublishedId, previousCandidateId, previousSourceStatus, previousReviewComment, previousAuditFields);
        throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Source publication changed concurrently');
      }
      source.currentPublishedVersionId = version._id;
      if (source.currentCandidateVersionId?.equals(version._id)) source.currentCandidateVersionId = undefined;
      source.status = 'published';
    }
    try {
      await this.events.append({ programId: command.programId, sourceId: command.sourceId, versionId: command.versionId, actorId: command.actorId, actorEmail: command.actorEmail, actorType: 'user', eventType: ({ to_review: 'version.submitted_for_review', captured: 'version.returned_to_editing', approved: 'version.approved', rejected: 'version.rejected', published: 'version.published', superseded: 'version.superseded' } as const)[command.target], before: { lifecycleStatus: before }, after: { lifecycleStatus: command.target }, reason: command.comment, correlationId: command.correlationId, deduplicationKey: this.deduplicationKey(command), session });
    } catch (error) {
      if (!session) await this.compensateFailedFallback(command, source, before, previousPublishedId, previousCandidateId, previousSourceStatus, previousReviewComment, previousAuditFields);
      throw error;
    }
    return version;
  }

  private async compensateFailedFallback(command: SourceVersionTransitionCommand, source: GovernanceSourceDocument, before: GovernanceSourceVersionLifecycleStatus, previousPublishedId: Types.ObjectId | undefined, previousCandidateId: Types.ObjectId | undefined, previousSourceStatus: GovernanceSourceDocument['status'], previousReviewComment: string | undefined, previousAuditFields: Record<string, unknown>): Promise<void> {
    const unset: Record<string, 1> = {};
    const restore: Record<string, unknown> = { lifecycleStatus: before };
    const auditFields = command.target === 'to_review' ? ['submittedForReviewBy', 'submittedForReviewAt'] : command.target === 'approved' ? ['reviewedBy', 'reviewedAt', 'approvedBy', 'approvedAt'] : command.target === 'published' ? ['publishedBy', 'publishedAt'] : [];
    for (const field of auditFields) {
      if (previousAuditFields[field] === undefined) unset[field] = 1;
      else restore[field] = previousAuditFields[field];
    }
    if (previousReviewComment === undefined) unset.reviewComment = 1;
    else restore.reviewComment = previousReviewComment;
    await this.versionModel.updateOne({ _id: new Types.ObjectId(command.versionId), lifecycleStatus: command.target }, { $set: restore, ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}) }).exec();
    if (command.target !== 'published') return;
    const sourceSet: Record<string, unknown> = { status: previousSourceStatus };
    const sourceUnset: Record<string, 1> = {};
    if (previousPublishedId) sourceSet.currentPublishedVersionId = previousPublishedId;
    else sourceUnset.currentPublishedVersionId = 1;
    if (previousCandidateId) sourceSet.currentCandidateVersionId = previousCandidateId;
    else sourceUnset.currentCandidateVersionId = 1;
    await this.sourceModel.updateOne({ _id: source._id, currentPublishedVersionId: new Types.ObjectId(command.versionId) }, { $set: sourceSet, ...(Object.keys(sourceUnset).length > 0 ? { $unset: sourceUnset } : {}) }).exec();
    if (previousPublishedId) await this.versionModel.updateOne({ _id: previousPublishedId, lifecycleStatus: 'superseded' }, { $set: { lifecycleStatus: 'published' } }).exec();
  }

  private async assertAccess(command: SourceVersionTransitionCommand): Promise<void> {
    const source = await this.sourceModel.findOne({ _id: new Types.ObjectId(command.sourceId), programId: new Types.ObjectId(command.programId) }).exec();
    if (!source) throw new BadRequestException(ErrorCode.GOVERNANCE_SOURCE_NOT_FOUND);
    const scopeId = source.ownerScopeId?.toString() ?? source.scopeIds[0]?.toString();
    if (scopeId) await this.access.assertScopeRole(command.actorId, command.programId, scopeId, command.target === 'published' ? ['scope_approver', 'scope_admin'] : command.target === 'to_review' ? ['scope_editor', 'scope_reviewer', 'scope_approver', 'scope_admin'] : ['scope_reviewer', 'scope_approver', 'scope_admin']);
    else await this.access.assertProgramWideAccess(command.actorId, command.programId);
  }

  private async findVersion(command: SourceVersionTransitionCommand, versionId: string): Promise<GovernanceSourceVersionDocument> {
    const version = await this.versionModel.findOne({ _id: new Types.ObjectId(versionId), sourceId: new Types.ObjectId(command.sourceId), programId: new Types.ObjectId(command.programId) }).exec();
    if (!version) throw new BadRequestException(ErrorCode.GOVERNANCE_SOURCE_NOT_FOUND);
    return version;
  }

  private deduplicationKey(command: SourceVersionTransitionCommand): string { return `transition:${command.commandId}`; }
  private isTransactionUnavailable(error: unknown): boolean { return error instanceof Error && /Transaction numbers are only allowed|does not support transactions|replica set/i.test(error.message); }
}
