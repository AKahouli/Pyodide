import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { WorkspaceDoc, WorkspaceDocumentDoc } from '@modules/workspace/schemas/workspace-document.schema';
import { GovernanceDocument, GovernanceDocumentDocument } from '../schemas/governance-document.schema';
import { GovernanceWorkspaceBinding, GovernanceWorkspaceBindingDocument } from '../schemas/governance-workspace-binding.schema';
import { GovernanceProgramService } from './governance-program.service';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceDocumentEventService } from './governance-document-event.service';
import { DocumentValidityCalculatorService } from './document-validity-calculator.service';
import { DEFAULT_UNKNOWN_VALIDITY, type DocumentValidity } from '../domain/document-validity';
import type { UpdateGovernanceDocumentDto } from '../dto/update-governance-document.dto';

export interface GovernanceDocumentResponse {
  id: string;
  programId: string;
  documentId: string;
  workspaceId: string;
  document: { originalName: string; mimeType: string; type: string; sourceUrl?: string; contentHash?: string; status: string; indexingStatus: string; updatedAt: string };
  governance: { status: string; validity: DocumentValidity; tags: string[]; metadata: Record<string, unknown>; ownerUserId?: string; ownerScopeId?: string; archivedAt?: string; archiveReason?: string; createdAt: string; updatedAt: string };
}

@Injectable()
export class GovernanceDocumentService {
  constructor(
    @InjectModel(GovernanceDocument.name) private readonly model: Model<GovernanceDocumentDocument>,
    @InjectModel(WorkspaceDoc.name) private readonly workspaceDocuments: Model<WorkspaceDocumentDoc>,
    @InjectModel(GovernanceWorkspaceBinding.name) private readonly bindings: Model<GovernanceWorkspaceBindingDocument>,
    private readonly programs: GovernanceProgramService,
    private readonly access: GovernanceAccessService,
    private readonly events: GovernanceDocumentEventService,
    private readonly validityCalculator: DocumentValidityCalculatorService,
  ) {}

  async upsertFromWorkspace(programId: string, documentId: string, actorId: string, integrationEvent?: { id: string; occurredAt: Date }): Promise<GovernanceDocumentDocument> {
    const document = await this.workspaceDocuments.findOne({ _id: new Types.ObjectId(documentId), isFolder: false }).exec();
    if (!document) throw new NotFoundException(ErrorCode.GOVERNANCE_DOCUMENT_NOT_FOUND);
    const binding = await this.bindings.findOne({ programId: new Types.ObjectId(programId), workspaceId: document.workspaceId, enabled: true }).exec();
    if (!binding) throw new BadRequestException(ErrorCode.GOVERNANCE_DOCUMENT_SCOPE_INVALID, 'No enabled workspace binding grants governance access to this document');
    const validity = { ...DEFAULT_UNKNOWN_VALIDITY, mode: binding.defaults.validityMode ?? 'unknown', reviewFrequencyDays: binding.defaults.reviewFrequencyDays };
    const update = {
      $setOnInsert: {
        programId: new Types.ObjectId(programId),
        documentId: document._id,
        workspaceId: document.workspaceId,
        status: 'captured',
        validity,
        tags: [],
        metadata: {},
        ownerUserId: binding.defaults.ownerUserId ? new Types.ObjectId(binding.defaults.ownerUserId) : undefined,
        ownerScopeId: binding.defaults.ownerScopeId ? new Types.ObjectId(binding.defaults.ownerScopeId) : undefined,
        governanceRevision: 0,
        temporalDecisionRevision: 0,
      },
      $set: {
        workspaceId: document.workspaceId,
        ...(integrationEvent ? { lastIntegrationEventId: integrationEvent.id, lastIntegrationEventAt: integrationEvent.occurredAt } : {}),
      },
    };
    const governanceDocument = await this.model.findOneAndUpdate({ programId: new Types.ObjectId(programId), documentId: document._id }, update, { new: true, upsert: true, setDefaultsOnInsert: true }).exec();
    if (!governanceDocument) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Governance document upsert failed');
    await this.events.append({ programId, governanceDocumentId: governanceDocument._id.toString(), documentId, eventType: 'document.governance_created', actorId, actorType: integrationEvent ? 'integration' : 'user', occurredAt: integrationEvent?.occurredAt, deduplicationKey: `created:${governanceDocument._id.toString()}` });
    return governanceDocument;
  }

  async list(actorId: string, programId: string, includeArchived = false): Promise<GovernanceDocumentResponse[]> {
    await this.programs.assertOwnedProgram(actorId, programId);
    const workspaceIds = await this.accessibleWorkspaceIds(actorId, programId);
    const records = await this.model.find({ programId: new Types.ObjectId(programId), workspaceId: { $in: workspaceIds }, ...(includeArchived ? {} : { status: { $ne: 'archived' } }) }).sort({ updatedAt: -1 }).lean().exec();
    return Promise.all(records.map((record) => this.toResponse(record)));
  }

  async findByDocumentId(actorId: string, programId: string, documentId: string): Promise<GovernanceDocumentResponse> {
    return this.toResponse(await this.findAccessible(actorId, programId, documentId));
  }

  async findRecord(actorId: string, programId: string, documentId: string): Promise<GovernanceDocumentDocument> {
    const record = await this.model.findOne({ programId: new Types.ObjectId(programId), documentId: new Types.ObjectId(documentId) }).exec();
    if (!record) throw new NotFoundException(ErrorCode.GOVERNANCE_DOCUMENT_NOT_FOUND);
    await this.assertBindingAccess(actorId, programId, record.workspaceId);
    return record;
  }

  async update(actorId: string, programId: string, documentId: string, dto: UpdateGovernanceDocumentDto): Promise<GovernanceDocumentResponse> {
    const record = await this.findRecord(actorId, programId, documentId);
    if (dto.tags !== undefined) record.tags = dto.tags;
    if (dto.metadata !== undefined) record.metadata = dto.metadata;
    if (dto.ownerUserId !== undefined) record.ownerUserId = new Types.ObjectId(dto.ownerUserId);
    if (dto.ownerScopeId !== undefined) record.ownerScopeId = new Types.ObjectId(dto.ownerScopeId);
    record.governanceRevision += 1;
    await record.save();
    return this.toResponse(record);
  }

  async updateValidity(actorId: string, programId: string, documentId: string, patch: Partial<DocumentValidity>): Promise<GovernanceDocumentResponse> {
    const record = await this.findRecord(actorId, programId, documentId);
    const validity = { ...record.validity, ...patch, evidence: record.validity.evidence ?? [], manuallyOverridden: patch.manuallyOverridden ?? true };
    this.validityCalculator.assertValid(validity);
    const before = record.validity;
    record.validity = validity;
    record.governanceRevision += 1;
    await record.save();
    await this.events.append({ programId, governanceDocumentId: record._id.toString(), documentId, actorId, eventType: 'validity.updated', before: { validity: before }, after: { validity } });
    return this.toResponse(record);
  }

  async archive(actorId: string, programId: string, documentId: string, reason?: string): Promise<GovernanceDocumentResponse> {
    const record = await this.findRecord(actorId, programId, documentId);
    if (record.status !== 'archived') {
      const before = record.status;
      record.status = 'archived';
      record.archivedAt = new Date();
      record.archivedBy = new Types.ObjectId(actorId);
      record.archiveReason = reason;
      record.governanceRevision += 1;
      await record.save();
      await this.events.append({ programId, governanceDocumentId: record._id.toString(), documentId, actorId, eventType: 'document.archived', reason, before: { status: before }, after: { status: 'archived' } });
    }
    return this.toResponse(record);
  }

  async restore(actorId: string, programId: string, documentId: string): Promise<GovernanceDocumentResponse> {
    const record = await this.findRecord(actorId, programId, documentId);
    if (record.status === 'archived') {
      record.status = 'captured';
      record.archivedAt = undefined;
      record.archivedBy = undefined;
      record.archiveReason = undefined;
      record.governanceRevision += 1;
      await record.save();
      await this.events.append({ programId, governanceDocumentId: record._id.toString(), documentId, actorId, eventType: 'document.restored', before: { status: 'archived' }, after: { status: 'captured' } });
    }
    return this.toResponse(record);
  }

  async archiveFromWorkspaceDeletion(programId: string, documentId: string, actorId: string, integrationEvent: { id: string; occurredAt: Date }): Promise<void> {
    const record = await this.model.findOneAndUpdate(
      { programId: new Types.ObjectId(programId), documentId: new Types.ObjectId(documentId), status: { $ne: 'archived' }, lastIntegrationEventId: { $ne: integrationEvent.id } },
      { $set: { status: 'archived', archivedAt: integrationEvent.occurredAt, archivedBy: new Types.ObjectId(actorId), archiveReason: 'Workspace document deleted', lastIntegrationEventId: integrationEvent.id, lastIntegrationEventAt: integrationEvent.occurredAt }, $inc: { governanceRevision: 1 } },
      { new: true },
    ).exec();
    if (!record) return;
    await this.events.append({ programId, governanceDocumentId: record._id.toString(), documentId, actorId, actorType: 'integration', eventType: 'document.archived', occurredAt: integrationEvent.occurredAt, reason: 'Workspace document deleted', after: { status: 'archived' }, deduplicationKey: `workspace-deleted:${integrationEvent.id}` });
  }

  async deleteGovernance(actorId: string, programId: string, documentId: string, confirm: boolean): Promise<void> {
    if (!confirm) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Governance deletion requires explicit confirmation');
    const record = await this.findRecord(actorId, programId, documentId);
    if (record.status !== 'archived') throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Archive document governance before deletion');
    await this.events.append({ programId, governanceDocumentId: record._id.toString(), documentId, actorId, eventType: 'document.governance_deleted' });
    await record.deleteOne();
  }

  private async findAccessible(actorId: string, programId: string, documentId: string): Promise<GovernanceDocumentDocument> {
    return this.findRecord(actorId, programId, documentId);
  }

  private async accessibleWorkspaceIds(actorId: string, programId: string): Promise<Types.ObjectId[]> {
    const accessibleScopeIds = await this.access.getAccessibleScopeIds(actorId, programId);
    const scopeObjectIds = accessibleScopeIds.filter((id) => id !== '*').map((id) => new Types.ObjectId(id));
    const filter = accessibleScopeIds.includes('*')
      ? { programId: new Types.ObjectId(programId), enabled: true }
      : { programId: new Types.ObjectId(programId), enabled: true, $or: [{ visibility: 'program_shared' }, { scopeIds: { $in: scopeObjectIds } }] };
    return (await this.bindings.find(filter).select({ workspaceId: 1 }).lean().exec()).map((binding) => binding.workspaceId);
  }

  private async assertBindingAccess(actorId: string, programId: string, workspaceId: Types.ObjectId): Promise<void> {
    const allowed = await this.accessibleWorkspaceIds(actorId, programId);
    if (!allowed.some((id) => id.equals(workspaceId))) throw new NotFoundException(ErrorCode.GOVERNANCE_DOCUMENT_NOT_FOUND);
  }

  private async toResponse(record: Pick<GovernanceDocument, keyof GovernanceDocument> & { _id: Types.ObjectId }): Promise<GovernanceDocumentResponse> {
    const document = await this.workspaceDocuments.findOne({ _id: record.documentId, workspaceId: record.workspaceId, isFolder: false }).lean().exec();
    if (!document) throw new NotFoundException(ErrorCode.GOVERNANCE_DOCUMENT_NOT_FOUND);
    const iso = (value?: Date): string | undefined => value?.toISOString();
    return {
      id: record._id.toString(),
      programId: record.programId.toString(),
      documentId: record.documentId.toString(),
      workspaceId: record.workspaceId.toString(),
      document: { originalName: document.originalName, mimeType: document.mimeType, type: document.type, sourceUrl: document.sourceUrl, contentHash: document.contentHash, status: document.status, indexingStatus: document.indexingStatus, updatedAt: iso(document.updatedAt) ?? '' },
      governance: { status: record.status, validity: record.validity, tags: record.tags ?? [], metadata: record.metadata ?? {}, ownerUserId: record.ownerUserId?.toString(), ownerScopeId: record.ownerScopeId?.toString(), archivedAt: iso(record.archivedAt), archiveReason: record.archiveReason, createdAt: iso(record.createdAt) ?? '', updatedAt: iso(record.updatedAt) ?? '' },
    };
  }
}
