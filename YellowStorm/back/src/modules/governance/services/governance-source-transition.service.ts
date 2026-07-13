import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { GovernanceSource, GovernanceSourceDocument } from '../schemas/governance-source.schema';
import { GovernanceSourceVersion, GovernanceSourceVersionDocument, type GovernanceSourceVersionLifecycleStatus } from '../schemas/governance-source-version.schema';
import { GovernanceAccessService } from './governance-access.service';
import { GovernanceSourceEventService } from './governance-source-event.service';

const transitions: Record<GovernanceSourceVersionLifecycleStatus, GovernanceSourceVersionLifecycleStatus[]> = { captured: ['to_review', 'rejected'], to_review: ['approved', 'rejected', 'captured'], approved: ['published', 'rejected'], published: ['superseded'], rejected: [], superseded: [] };
@Injectable()
export class GovernanceSourceTransitionService {
  constructor(@InjectModel(GovernanceSource.name) private readonly sourceModel: Model<GovernanceSourceDocument>, @InjectModel(GovernanceSourceVersion.name) private readonly versionModel: Model<GovernanceSourceVersionDocument>, private readonly access: GovernanceAccessService, private readonly events: GovernanceSourceEventService) {}
  async transition(actorId: string, programId: string, sourceId: string, versionId: string, target: GovernanceSourceVersionLifecycleStatus, comment?: string): Promise<GovernanceSourceVersionDocument> {
    const source = await this.sourceModel.findOne({ _id: new Types.ObjectId(sourceId), programId: new Types.ObjectId(programId) }).exec();
    const version = await this.versionModel.findOne({ _id: new Types.ObjectId(versionId), sourceId: new Types.ObjectId(sourceId), programId: new Types.ObjectId(programId) }).exec();
    if (!source || !version) throw new BadRequestException(ErrorCode.GOVERNANCE_SOURCE_NOT_FOUND);
    if (!transitions[version.lifecycleStatus].includes(target)) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Invalid source-version lifecycle transition');
    const scopeId = source.ownerScopeId?.toString() ?? source.scopeIds[0]?.toString();
    if (scopeId) await this.access.assertScopeRole(actorId, programId, scopeId, target === 'published' ? ['scope_approver', 'scope_admin'] : target === 'to_review' ? ['scope_editor', 'scope_reviewer', 'scope_approver', 'scope_admin'] : ['scope_reviewer', 'scope_approver', 'scope_admin']);
    else await this.access.assertProgramWideAccess(actorId, programId);
    if (target === 'published' && version.technicalStatus !== 'ready') throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'A source version must be technically ready before publication');
    const before = version.lifecycleStatus;
    if (target === 'published' && source.currentPublishedVersionId) await this.versionModel.updateOne({ _id: source.currentPublishedVersionId }, { $set: { lifecycleStatus: 'superseded' } }).exec();
    version.lifecycleStatus = target; version.reviewComment = comment;
    if (target === 'approved') { version.approvedBy = new Types.ObjectId(actorId); version.approvedAt = new Date(); }
    if (target === 'to_review') { version.reviewedBy = new Types.ObjectId(actorId); version.reviewedAt = new Date(); }
    await version.save();
    if (target === 'published') { source.currentPublishedVersionId = version._id; if (source.currentCandidateVersionId?.equals(version._id)) source.currentCandidateVersionId = undefined; source.status = 'published'; await source.save(); }
    await this.events.append({ programId, sourceId, versionId, actorId, eventType: ({ to_review: 'version.submitted_for_review', captured: 'version.returned_to_editing', approved: 'version.approved', rejected: 'version.rejected', published: 'version.published', superseded: 'version.superseded' } as const)[target], before: { lifecycleStatus: before }, after: { lifecycleStatus: target }, reason: comment });
    return version;
  }
}
