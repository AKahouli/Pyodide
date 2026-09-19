import { Inject, BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { DocumentStatus, IndexingStatus } from '@modules/workspace/interfaces/document-status.enum';
import { WORKSPACE_DOCUMENT_READ_PORT, type WorkspaceDocumentReadPort } from '@modules/workspace/ports';
import { GovernanceDocument, GovernanceDocumentDocument, GovernanceDocumentLifecycleStatus } from '../schemas/governance-document.schema';
import { GovernanceDocumentService } from './governance-document.service';
import { GovernanceDocumentEventService } from './governance-document-event.service';

const transitions: Record<GovernanceDocumentLifecycleStatus, GovernanceDocumentLifecycleStatus[]> = {
  captured: ['to_review', 'rejected'],
  to_review: ['approved', 'rejected', 'captured'],
  approved: ['published', 'rejected'],
  published: [],
  rejected: [],
  archived: [],
};

export interface GovernanceDocumentTransitionCommand { commandId: string; expectedGovernanceRevision: number; actorId: string; actorEmail?: string; programId: string; documentId: string; target: GovernanceDocumentLifecycleStatus; comment?: string; correlationId?: string }

@Injectable()
export class GovernanceDocumentTransitionService {
  constructor(
    @InjectModel(GovernanceDocument.name) private readonly model: Model<GovernanceDocumentDocument>,
    @Inject(WORKSPACE_DOCUMENT_READ_PORT) private readonly workspaceDocuments: WorkspaceDocumentReadPort,
    private readonly documents: GovernanceDocumentService,
    private readonly events: GovernanceDocumentEventService,
  ) {}

  async transition(command: GovernanceDocumentTransitionCommand): Promise<GovernanceDocumentDocument> {
    const record = await this.documents.findRecord(command.actorId, command.programId, command.documentId);
    const key = `transition:${command.commandId}`;
    if (await this.events.findByDeduplicationKey(record._id.toString(), key)) return record;
    if (record.governanceRevision !== command.expectedGovernanceRevision) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Document governance changed concurrently; reload and retry');
    if (!transitions[record.status].includes(command.target)) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid document governance lifecycle transition');
    if (command.target === 'published') await this.assertPublishable(record);
    const before = record.status;
    const now = new Date();
    const set: Record<string, unknown> = { status: command.target, reviewComment: command.comment };
    if (command.target === 'to_review') Object.assign(set, { submittedForReviewBy: new Types.ObjectId(command.actorId), submittedForReviewAt: now });
    if (command.target === 'approved') Object.assign(set, { reviewedBy: new Types.ObjectId(command.actorId), reviewedAt: now, approvedBy: new Types.ObjectId(command.actorId), approvedAt: now });
    if (command.target === 'published') Object.assign(set, { publishedBy: new Types.ObjectId(command.actorId), publishedAt: now });
    const updated = await this.model.findOneAndUpdate({ _id: record._id, status: before, governanceRevision: command.expectedGovernanceRevision }, { $set: set, $inc: { governanceRevision: 1 } }, { new: true }).exec();
    if (!updated) throw new ConflictException(ErrorCode.VALIDATION_ERROR, 'Document governance changed concurrently; reload and retry');
    const eventType = ({ to_review: 'document.submitted_for_review', captured: 'document.returned_to_editing', approved: 'document.approved', rejected: 'document.rejected', published: 'document.published' } as const)[command.target as Exclude<GovernanceDocumentLifecycleStatus, 'archived'>];
    if (!eventType) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Unsupported document governance lifecycle transition');
    await this.events.append({ programId: command.programId, governanceDocumentId: updated._id.toString(), documentId: command.documentId, actorId: command.actorId, actorEmail: command.actorEmail, actorType: 'user', eventType, before: { status: before }, after: { status: command.target }, reason: command.comment, correlationId: command.correlationId, deduplicationKey: key });
    return updated;
  }

  private async assertPublishable(record: GovernanceDocumentDocument): Promise<void> {
    const document = await this.workspaceDocuments.findOne({ id: record.documentId.toString(), workspaceId: record.workspaceId.toString(), isFolder: false });
    if (!document || document.status !== DocumentStatus.COMPLETED || document.indexingStatus !== IndexingStatus.READY) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Document must be completed and indexed before publication');
    if (['expired', 'conflicting', 'suspended'].includes(record.validity.businessStatus)) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Document validity blocks publication');
  }
}
