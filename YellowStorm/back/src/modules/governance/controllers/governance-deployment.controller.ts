import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { CreateGovernanceDeploymentDto, CreateGovernanceRevisionDto, PublishGovernanceDeploymentDto, UpdateGovernanceDeploymentDto, UpdateGovernanceRevisionDto } from '../dto';
import { GovernanceDeploymentResponse, GovernanceDeploymentService, GovernanceReadiness, GovernanceRevisionResponse } from '../services/governance-deployment.service';

@ApiTags('Governance Deployments')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller()
export class GovernanceDeploymentController {
  constructor(private readonly deploymentService: GovernanceDeploymentService) {}

  @Get('governance/programs/:programId/deployments')
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'List governance deployments for a program' })
  async list(@CurrentUser() user: UserDocument, @Param('programId') programId: string): Promise<GovernanceDeploymentResponse[]> {
    return this.deploymentService.list(user._id.toString(), programId);
  }

  @Post('governance/programs/:programId/deployments')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions([Permissions.GOVERNANCE_DEPLOYMENTS_MANAGE, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Create a governance deployment' })
  async create(@CurrentUser() user: UserDocument, @Param('programId') programId: string, @Body() dto: CreateGovernanceDeploymentDto): Promise<GovernanceDeploymentResponse> {
    return this.deploymentService.create(user._id.toString(), user.email, programId, dto);
  }

  @Get('governance/deployments/:deploymentId')
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  async get(@CurrentUser() user: UserDocument, @Param('deploymentId') deploymentId: string): Promise<GovernanceDeploymentResponse> {
    return this.deploymentService.findById(user._id.toString(), deploymentId);
  }

  @Patch('governance/deployments/:deploymentId')
  @RequirePermissions([Permissions.GOVERNANCE_DEPLOYMENTS_MANAGE, Permissions.GOVERNANCE_ALL], 'any')
  async update(@CurrentUser() user: UserDocument, @Param('deploymentId') deploymentId: string, @Body() dto: UpdateGovernanceDeploymentDto): Promise<GovernanceDeploymentResponse> {
    return this.deploymentService.update(user._id.toString(), deploymentId, dto);
  }

  @Get('governance/deployments/:deploymentId/revisions')
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  async revisions(@CurrentUser() user: UserDocument, @Param('deploymentId') deploymentId: string): Promise<GovernanceRevisionResponse[]> {
    return this.deploymentService.listRevisions(user._id.toString(), deploymentId);
  }

  @Post('governance/deployments/:deploymentId/revisions')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions([Permissions.GOVERNANCE_DEPLOYMENTS_MANAGE, Permissions.GOVERNANCE_ALL], 'any')
  async createRevision(@CurrentUser() user: UserDocument, @Param('deploymentId') deploymentId: string, @Body() dto: CreateGovernanceRevisionDto): Promise<GovernanceRevisionResponse> {
    return this.deploymentService.createRevision(user._id.toString(), user.email, deploymentId, dto);
  }

  @Patch('governance/deployments/:deploymentId/revisions/:revisionId')
  @RequirePermissions([Permissions.GOVERNANCE_DEPLOYMENTS_MANAGE, Permissions.GOVERNANCE_ALL], 'any')
  async updateRevision(@CurrentUser() user: UserDocument, @Param('deploymentId') deploymentId: string, @Param('revisionId') revisionId: string, @Body() dto: UpdateGovernanceRevisionDto): Promise<GovernanceRevisionResponse> {
    return this.deploymentService.updateRevision(user._id.toString(), deploymentId, revisionId, dto);
  }

  @Get('governance/deployments/:deploymentId/readiness')
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  async readiness(@CurrentUser() user: UserDocument, @Param('deploymentId') deploymentId: string): Promise<GovernanceReadiness> {
    return this.deploymentService.getReadiness(user._id.toString(), deploymentId);
  }

  @Get('governance/deployments/:deploymentId/resolve-context')
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  async resolveContext(@CurrentUser() user: UserDocument, @Param('deploymentId') deploymentId: string): Promise<Record<string, unknown>> {
    return this.deploymentService.resolveContext(user._id.toString(), deploymentId);
  }

  @Post('governance/deployments/:deploymentId/publish')
  @RequirePermissions([Permissions.GOVERNANCE_PUBLISH, Permissions.GOVERNANCE_ALL], 'any')
  async publish(@CurrentUser() user: UserDocument, @Param('deploymentId') deploymentId: string, @Body() dto: PublishGovernanceDeploymentDto): Promise<GovernanceDeploymentResponse> {
    return this.deploymentService.publish(user._id.toString(), user.email, deploymentId, dto);
  }

  @Post('governance/deployments/:deploymentId/rollback')
  @RequirePermissions([Permissions.GOVERNANCE_PUBLISH, Permissions.GOVERNANCE_ALL], 'any')
  async rollback(@CurrentUser() user: UserDocument, @Param('deploymentId') deploymentId: string): Promise<GovernanceDeploymentResponse> {
    return this.deploymentService.rollback(user._id.toString(), user.email, deploymentId);
  }

  @Post('governance/deployments/:deploymentId/suspend')
  @RequirePermissions([Permissions.GOVERNANCE_DEPLOYMENTS_MANAGE, Permissions.GOVERNANCE_ALL], 'any')
  async suspend(@CurrentUser() user: UserDocument, @Param('deploymentId') deploymentId: string): Promise<GovernanceDeploymentResponse> {
    return this.deploymentService.suspend(user._id.toString(), user.email, deploymentId);
  }
}
