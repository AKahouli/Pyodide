import { Body, Controller, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { CreateGovernanceDryRunDto, MarkGovernanceDryRunDto } from '../dto';
import { GovernanceDryRunResponse, GovernanceDryRunService } from '../services/governance-dry-run.service';

@ApiTags('Governance Dry-runs')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller()
export class GovernanceDryRunController {
  constructor(private readonly dryRunService: GovernanceDryRunService) {}

  @Get('governance/deployments/:deploymentId/dry-runs')
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  async list(@CurrentUser() user: AuthUser, @Param('deploymentId') deploymentId: string): Promise<GovernanceDryRunResponse[]> {
    return this.dryRunService.list(user._id.toString(), deploymentId);
  }

  @Post('governance/deployments/:deploymentId/dry-runs')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions([Permissions.GOVERNANCE_DRY_RUNS_EXECUTE, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'Create a dry-run against the draft revision' })
  async create(@CurrentUser() user: AuthUser, @Param('deploymentId') deploymentId: string, @Body() dto: CreateGovernanceDryRunDto): Promise<GovernanceDryRunResponse> {
    return this.dryRunService.create(user._id.toString(), user.email, deploymentId, dto);
  }

  @Get('governance/dry-runs/:dryRunId')
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  async get(@CurrentUser() user: AuthUser, @Param('dryRunId') dryRunId: string): Promise<GovernanceDryRunResponse> {
    return this.dryRunService.findById(user._id.toString(), dryRunId);
  }

  @Get('governance/dry-runs/:dryRunId/messages')
  @RequirePermissions([Permissions.GOVERNANCE_READ, Permissions.GOVERNANCE_ALL], 'any')
  async messages(@CurrentUser() user: AuthUser, @Param('dryRunId') dryRunId: string): Promise<Array<Record<string, unknown>>> {
    return this.dryRunService.messages(user._id.toString(), dryRunId);
  }

  @Patch('governance/dry-runs/:dryRunId/result')
  @RequirePermissions([Permissions.GOVERNANCE_DRY_RUNS_EXECUTE, Permissions.GOVERNANCE_ALL], 'any')
  async mark(@CurrentUser() user: AuthUser, @Param('dryRunId') dryRunId: string, @Body() dto: MarkGovernanceDryRunDto): Promise<GovernanceDryRunResponse> {
    return this.dryRunService.mark(user._id.toString(), user.email, dryRunId, dto);
  }
}
