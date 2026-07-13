import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { CreateGovernanceSourceDto, CreateGovernanceSourceVersionDto, SourceVersionTransitionDto, UpdateGovernanceSourceDto, UpdateSourceValidityDto } from '../dto';
import { GovernanceSourceResponse, GovernanceSourceService } from '../services/governance-source.service';
import { GovernanceSourceVersionService } from '../services/governance-source-version.service';
import { GovernanceSourceTransitionService } from '../services/governance-source-transition.service';
import { GovernanceSourceEventService } from '../services/governance-source-event.service';
import type { GovernanceSourceVersionLifecycleStatus } from '../schemas/governance-source-version.schema';
import type { SourceValidityEvidence } from '../domain/source-validity';

@ApiTags('Governance Sources')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('governance/programs/:programId/sources')
export class GovernanceSourceController {
  constructor(private readonly sourceService: GovernanceSourceService, private readonly versionService: GovernanceSourceVersionService, private readonly transitions: GovernanceSourceTransitionService, private readonly events: GovernanceSourceEventService, private readonly config: ConfigService) {}

  private assertVersioningEnabled(): void { if (!this.config.get<boolean>('dataRoom.sourceVersioningEnabled')) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Source versioning is disabled'); }

  @Get(':sourceId/versions')
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  async listVersions(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('sourceId') sourceId: string) { this.assertVersioningEnabled(); await this.sourceService.findById(user._id.toString(), programId, sourceId); return this.versionService.list(sourceId); }

  @Post(':sourceId/versions')
  @RequirePermissions([Permissions.GOVERNANCE_SOURCES_EDIT, Permissions.GOVERNANCE_ALL], 'any')
  async createVersion(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('sourceId') sourceId: string, @Body() dto: CreateGovernanceSourceVersionDto) { this.assertVersioningEnabled(); await this.sourceService.findById(user._id.toString(), programId, sourceId); return this.versionService.create(user._id.toString(), programId, sourceId, dto); }

  @Get(':sourceId/versions/:versionId')
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  async getVersion(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('sourceId') sourceId: string, @Param('versionId') versionId: string) { this.assertVersioningEnabled(); await this.sourceService.findById(user._id.toString(), programId, sourceId); return this.versionService.find(sourceId, versionId); }

  @Patch(':sourceId/versions/:versionId/validity')
  @RequirePermissions([Permissions.GOVERNANCE_SOURCES_REVIEW, Permissions.GOVERNANCE_ALL], 'any')
  async updateValidity(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('sourceId') sourceId: string, @Param('versionId') versionId: string, @Body() dto: UpdateSourceValidityDto) { this.assertVersioningEnabled(); await this.sourceService.findById(user._id.toString(), programId, sourceId); return this.versionService.updateValidity(user._id.toString(), programId, sourceId, versionId, { mode: dto.mode as never, businessStatus: dto.businessStatus as never, effectiveUntil: dto.effectiveUntil ? new Date(dto.effectiveUntil) : undefined, confidence: dto.confidence ?? 0, evidence: (dto.evidence ?? []).map((evidence) => ({ ...evidence, field: evidence.field as SourceValidityEvidence['field'], origin: evidence.origin as SourceValidityEvidence['origin'], validatedAt: evidence.validatedAt ? new Date(evidence.validatedAt) : undefined })), manuallyOverridden: dto.manuallyOverridden ?? false }); }

  @Post(':sourceId/versions/:versionId/:action')
  @RequirePermissions([Permissions.GOVERNANCE_SOURCES_REVIEW, Permissions.GOVERNANCE_PUBLISH, Permissions.GOVERNANCE_ALL], 'any')
  async transition(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('sourceId') sourceId: string, @Param('versionId') versionId: string, @Param('action') action: string, @Body() dto: SourceVersionTransitionDto) { this.assertVersioningEnabled(); const target = ({ 'submit-review': 'to_review', 'return-to-editing': 'captured', approve: 'approved', reject: 'rejected', publish: 'published' } satisfies Record<string, GovernanceSourceVersionLifecycleStatus>)[action]; if (!target) throw new BadRequestException(ErrorCode.VALIDATION_ERROR, 'Unsupported source-version action'); return this.transitions.transition(user._id.toString(), programId, sourceId, versionId, target, dto.comment); }

  @Get(':sourceId/events')
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  async listEvents(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Param('sourceId') sourceId: string) { this.assertVersioningEnabled(); await this.sourceService.findById(user._id.toString(), programId, sourceId); return this.events.list(sourceId); }

  @Get()
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'List governance sources for a program' })
  async listSources(@CurrentUser() user: UserDocument, @Param('programId') programId: string): Promise<GovernanceSourceResponse[]> {
    return this.sourceService.list(user._id.toString(), programId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions([Permissions.GOVERNANCE_SOURCES_EDIT, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Create a governance source' })
  @ApiResponse({ status: 201, description: 'Governance source created' })
  async createSource(
    @CurrentUser() user: UserDocument,
    @Param('programId') programId: string,
    @Body() dto: CreateGovernanceSourceDto,
  ): Promise<GovernanceSourceResponse> {
    return this.sourceService.create(user._id.toString(), programId, dto);
  }

  @Get(':sourceId')
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Get a governance source' })
  @ApiParam({ name: 'sourceId', description: 'Governance source ID' })
  async getSource(
    @CurrentUser() user: UserDocument,
    @Param('programId') programId: string,
    @Param('sourceId') sourceId: string,
  ): Promise<GovernanceSourceResponse> {
    return this.sourceService.findById(user._id.toString(), programId, sourceId);
  }

  @Patch(':sourceId')
  @RequirePermissions([Permissions.GOVERNANCE_SOURCES_EDIT, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Update a governance source' })
  async updateSource(
    @CurrentUser() user: UserDocument,
    @Param('programId') programId: string,
    @Param('sourceId') sourceId: string,
    @Body() dto: UpdateGovernanceSourceDto,
  ): Promise<GovernanceSourceResponse> {
    return this.sourceService.update(user._id.toString(), programId, sourceId, dto);
  }

  @Delete(':sourceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions([Permissions.GOVERNANCE_SOURCES_EDIT, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Delete a governance source' })
  async deleteSource(
    @CurrentUser() user: UserDocument,
    @Param('programId') programId: string,
    @Param('sourceId') sourceId: string,
  ): Promise<void> {
    return this.sourceService.delete(user._id.toString(), programId, sourceId);
  }
}
