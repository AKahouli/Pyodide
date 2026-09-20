import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { GovernanceKnowledgeAssessmentService } from '../services/governance-knowledge-assessment.service';
import { KnowledgeDecisionDto, KnowledgeListQueryDto, MetadataCandidateDecisionDto } from '../dto';

@ApiTags('Governance Knowledge Intelligence')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('governance/programs/:programId/knowledge')
export class GovernanceKnowledgeController {
  constructor(private readonly service: GovernanceKnowledgeAssessmentService) {}

  @Post('refresh') @RequirePermissions([Permissions.GOVERNANCE_DOCUMENTS_REVIEW, Permissions.GOVERNANCE_ALL], 'any') @ApiOperation({ summary: 'Assess governed documents and refresh actions' })
  refresh(@CurrentUser() user: AuthUser, @Param('programId') programId: string, @Query('scopeId') scopeId?: string) { return this.service.refresh(user._id.toString(), user.email, programId, scopeId); }

  @Get('health-summary') @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any') @ApiOperation({ summary: 'Get current knowledge health' })
  health(@CurrentUser() user: AuthUser, @Param('programId') programId: string, @Query('scopeId') scopeId?: string) { return this.service.healthSummary(user._id.toString(), programId, scopeId); }

  @Get('alerts') @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  alerts(@CurrentUser() user: AuthUser, @Param('programId') programId: string, @Query() query: KnowledgeListQueryDto) { return this.service.listAlerts(user._id.toString(), programId, query as Parameters<GovernanceKnowledgeAssessmentService['listAlerts']>[2]); }

  @Get('recommendations') @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  recommendations(@CurrentUser() user: AuthUser, @Param('programId') programId: string, @Query() query: KnowledgeListQueryDto) { return this.service.listRecommendations(user._id.toString(), programId, query as Parameters<GovernanceKnowledgeAssessmentService['listRecommendations']>[2]); }

  @Get('metadata-candidates') @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  metadataCandidates(@CurrentUser() user: AuthUser, @Param('programId') programId: string, @Query() query: KnowledgeListQueryDto) { return this.service.listMetadataCandidates(user._id.toString(), programId, query.scopeId, query.status as 'proposed' | 'accepted' | 'rejected' | 'superseded' | undefined); }

  @Post('alerts/:alertId/acknowledge') @RequirePermissions([Permissions.GOVERNANCE_DOCUMENTS_REVIEW, Permissions.GOVERNANCE_ALL], 'any')
  acknowledge(@CurrentUser() user: AuthUser, @Param('programId') programId: string, @Param('alertId') alertId: string) { return this.service.acknowledgeAlert(user._id.toString(), user.email, programId, alertId); }

  @Post('recommendations/:id/accept') @RequirePermissions([Permissions.GOVERNANCE_DOCUMENTS_REVIEW, Permissions.GOVERNANCE_ALL], 'any')
  acceptRecommendation(@CurrentUser() user: AuthUser, @Param('programId') programId: string, @Param('id') id: string, @Body() dto: KnowledgeDecisionDto) { return this.service.decideRecommendation(user._id.toString(), user.email, programId, id, 'accept', dto.reason); }

  @Post('recommendations/:id/reject') @RequirePermissions([Permissions.GOVERNANCE_DOCUMENTS_REVIEW, Permissions.GOVERNANCE_ALL], 'any')
  rejectRecommendation(@CurrentUser() user: AuthUser, @Param('programId') programId: string, @Param('id') id: string, @Body() dto: KnowledgeDecisionDto) { return this.service.decideRecommendation(user._id.toString(), user.email, programId, id, 'reject', dto.reason); }

  @Post('recommendations/:id/apply') @RequirePermissions([Permissions.GOVERNANCE_DOCUMENTS_REVIEW, Permissions.GOVERNANCE_ALL], 'any')
  applyRecommendation(@CurrentUser() user: AuthUser, @Param('programId') programId: string, @Param('id') id: string) { return this.service.applyRecommendation(user._id.toString(), user.email, programId, id); }

  @Post('metadata-candidates/:id/accept') @RequirePermissions([Permissions.GOVERNANCE_DOCUMENTS_REVIEW, Permissions.GOVERNANCE_ALL], 'any')
  acceptMetadata(@CurrentUser() user: AuthUser, @Param('programId') programId: string, @Param('id') id: string, @Body() dto: MetadataCandidateDecisionDto) { return this.service.decideMetadataCandidate(user._id.toString(), user.email, programId, id, 'accept', dto.acceptedValue, dto.reason); }

  @Post('metadata-candidates/:id/reject') @RequirePermissions([Permissions.GOVERNANCE_DOCUMENTS_REVIEW, Permissions.GOVERNANCE_ALL], 'any')
  rejectMetadata(@CurrentUser() user: AuthUser, @Param('programId') programId: string, @Param('id') id: string, @Body() dto: KnowledgeDecisionDto) { return this.service.decideMetadataCandidate(user._id.toString(), user.email, programId, id, 'reject', undefined, dto.reason); }
}
