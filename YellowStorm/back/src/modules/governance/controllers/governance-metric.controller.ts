import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { Permissions, PermissionsGuard, RequirePermissions } from '@modules/authorization';
import { GovernanceMetricResponse, GovernanceMetricService } from '../services/governance-metric.service';

@ApiTags('Governance Metrics')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@Controller('governance/programs/:programId/metrics')
export class GovernanceMetricController {
  constructor(private readonly metricService: GovernanceMetricService) {}

  @Get()
  @RequirePermissions([Permissions.GOVERNANCE_METRICS_READ, Permissions.GOVERNANCE_ALL], 'any')
  @ApiOperation({ summary: 'List governance metrics for a program' })
  async list(@CurrentUser() user: UserDocument, @Param('programId') programId: string): Promise<GovernanceMetricResponse[]> {
    return this.metricService.list(user._id.toString(), programId);
  }
}
