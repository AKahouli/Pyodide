import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { GovernanceDocumentService } from '../services/governance-document.service';
import { GovernanceDocumentTransitionService } from '../services/governance-document-transition.service';
import { GovernanceDocumentEventService } from '../services/governance-document-event.service';
import { UpdateGovernanceDocumentDto } from '../dto/update-governance-document.dto';
import { UpdateDocumentValidityDto } from '../dto/update-document-validity.dto';
import { DocumentLifecycleTransitionDto } from '../dto/document-lifecycle-transition.dto';
import { ArchiveGovernanceDocumentDto } from '../dto/archive-governance-document.dto';
import { DeleteGovernanceDocumentDto } from '../dto/delete-governance-document.dto';
import type { GovernanceDocumentLifecycleStatus } from '../schemas/governance-document.schema';
import { GovernanceTemporalCandidateService } from '../services/governance-temporal-candidate.service';
import { DecideTemporalCandidateDto } from '../dto/decide-temporal-candidate.dto';

@ApiTags('Governance Documents')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('governance/programs/:programId/documents')
export class GovernanceDocumentController {
  constructor(private readonly documents: GovernanceDocumentService, private readonly transitions: GovernanceDocumentTransitionService, private readonly events: GovernanceDocumentEventService, private readonly temporalCandidates: GovernanceTemporalCandidateService) {}

  @Get() @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any') @ApiOperation({ summary: 'List governed workspace documents for a program' })
  list(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Query('includeArchived') includeArchived?: string) { return this.documents.list(user._id.toString(), programId, includeArchived === 'true'); }

  @Post(':documentId') @RequirePermissions([Permissions.GOVERNANCE_DOCUMENTS_EDIT, Permissions.GOVERNANCE_ALL], 'any')
  create(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('documentId') documentId: string) { return this.documents.upsertFromWorkspace(programId, documentId, user._id.toString()); }

  @Get(':documentId') @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  get(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('documentId') documentId: string) { return this.documents.findByDocumentId(user._id.toString(), programId, documentId); }

  @Patch(':documentId') @RequirePermissions([Permissions.GOVERNANCE_DOCUMENTS_EDIT, Permissions.GOVERNANCE_ALL], 'any')
  update(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('documentId') documentId: string, @Body() dto: UpdateGovernanceDocumentDto) { return this.documents.update(user._id.toString(), programId, documentId, dto); }

  @Patch(':documentId/validity') @RequirePermissions([Permissions.GOVERNANCE_DOCUMENTS_REVIEW, Permissions.GOVERNANCE_ALL], 'any')
  updateValidity(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('documentId') documentId: string, @Body() dto: UpdateDocumentValidityDto) {
    const patch = {
      ...(dto.mode !== undefined ? { mode: dto.mode as never } : {}),
      ...(dto.businessStatus !== undefined ? { businessStatus: dto.businessStatus as never } : {}),
      ...(dto.effectiveFrom !== undefined ? { effectiveFrom: dto.effectiveFrom === null ? undefined : new Date(dto.effectiveFrom) } : {}),
      ...(dto.effectiveUntil !== undefined ? { effectiveUntil: dto.effectiveUntil === null ? undefined : new Date(dto.effectiveUntil) } : {}),
      ...(dto.inclusiveEnd !== undefined ? { inclusiveEnd: dto.inclusiveEnd } : {}),
      ...(dto.lastReviewedAt !== undefined ? { lastReviewedAt: dto.lastReviewedAt === null ? undefined : new Date(dto.lastReviewedAt) } : {}),
      ...(dto.nextReviewAt !== undefined ? { nextReviewAt: dto.nextReviewAt === null ? undefined : new Date(dto.nextReviewAt) } : {}),
      ...(dto.reviewFrequencyDays !== undefined ? { reviewFrequencyDays: dto.reviewFrequencyDays === null ? undefined : dto.reviewFrequencyDays } : {}),
      ...(dto.confidence !== undefined ? { confidence: dto.confidence } : {}),
      ...(dto.manuallyOverridden !== undefined ? { manuallyOverridden: dto.manuallyOverridden } : {}),
    };
    return this.documents.updateValidity(user._id.toString(), programId, documentId, dto.expectedGovernanceRevision, patch);
  }

  @Post(':documentId/archive') @RequirePermissions([Permissions.GOVERNANCE_DOCUMENTS_EDIT, Permissions.GOVERNANCE_ALL], 'any')
  archive(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('documentId') documentId: string, @Body() dto: ArchiveGovernanceDocumentDto) { return this.documents.archive(user._id.toString(), programId, documentId, dto.expectedGovernanceRevision, dto.reason); }

  @Post(':documentId/restore') @RequirePermissions([Permissions.GOVERNANCE_DOCUMENTS_EDIT, Permissions.GOVERNANCE_ALL], 'any')
  restore(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('documentId') documentId: string, @Body() dto: ArchiveGovernanceDocumentDto) { return this.documents.restore(user._id.toString(), programId, documentId, dto.expectedGovernanceRevision); }

  @Delete(':documentId/governance') @HttpCode(HttpStatus.NO_CONTENT) @RequirePermissions([Permissions.GOVERNANCE_ALL], 'all')
  deleteGovernance(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('documentId') documentId: string, @Body() dto: DeleteGovernanceDocumentDto) { return this.documents.deleteGovernance(user._id.toString(), programId, documentId, dto.confirm, dto.expectedGovernanceRevision); }

  @Get(':documentId/temporal-candidates') @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  listTemporalCandidates(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('documentId') documentId: string) { return this.temporalCandidates.list(user._id.toString(), programId, documentId); }

  @Post(':documentId/temporal-analysis') @RequirePermissions([Permissions.GOVERNANCE_DOCUMENTS_REVIEW, Permissions.GOVERNANCE_ALL], 'any')
  runTemporalAnalysis(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('documentId') documentId: string) { return this.temporalCandidates.run(user._id.toString(), programId, documentId); }

  @Get(':documentId/temporal-analysis') @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  getTemporalAnalysis(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('documentId') documentId: string) { return this.temporalCandidates.status(user._id.toString(), programId, documentId); }

  @Post(':documentId/temporal-candidates/:recordId/decision') @RequirePermissions([Permissions.GOVERNANCE_DOCUMENTS_REVIEW, Permissions.GOVERNANCE_ALL], 'any')
  decideTemporalCandidate(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('documentId') documentId: string, @Param('recordId') recordId: string, @Body() dto: DecideTemporalCandidateDto) { return this.temporalCandidates.decide(user._id.toString(), user.email, programId, documentId, recordId, dto); }

  @Post(':documentId/:action') @RequirePermissions([Permissions.GOVERNANCE_DOCUMENTS_REVIEW, Permissions.GOVERNANCE_PUBLISH, Permissions.GOVERNANCE_ALL], 'any')
  async transition(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('documentId') documentId: string, @Param('action') action: string, @Body() dto: DocumentLifecycleTransitionDto) {
    const target = ({ 'submit-review': 'to_review', 'return-to-editing': 'captured', approve: 'approved', reject: 'rejected', publish: 'published' } satisfies Record<string, GovernanceDocumentLifecycleStatus>)[action];
    if (!target) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Unsupported document governance action');
    await this.transitions.transition({ commandId: dto.commandId, expectedGovernanceRevision: dto.expectedGovernanceRevision, actorId: user._id.toString(), actorEmail: user.email, programId, documentId, target, comment: dto.comment });
    return this.documents.findByDocumentId(user._id.toString(), programId, documentId);
  }

  @Get(':documentId/events') @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  async listEvents(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('documentId') documentId: string) {
    const record = await this.documents.findRecord(user._id.toString(), programId, documentId);
    return this.events.list(record._id.toString());
  }
}
