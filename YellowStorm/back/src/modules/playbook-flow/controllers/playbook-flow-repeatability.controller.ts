import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PlaybookFlowRepeatabilityService } from '../services/playbook-flow-repeatability.service';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { Permissions } from '@modules/authorization/constants/permissions';

@ApiTags('Playbook Flow Repeatability')
@ApiBearerAuth()
@Controller('playbooks')
@UseGuards(PermissionsGuard)
export class PlaybookFlowRepeatabilityController {
  constructor(
    private readonly repeatabilityService: PlaybookFlowRepeatabilityService,
  ) {}

  @Get(':id/repeatability')
  @ApiOperation({ summary: 'Get repeatability summary for a flow' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async getRepeatability(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Query('limit') limit?: number,
    @Query('offset') offset?: number,
  ) {
    return this.repeatabilityService.getRepeatability(flowId, limit || 5, offset || 0);
  }

  @Get(':id/repeatability/tasks/:taskId')
  @ApiOperation({ summary: 'Get per-task repeatability across executions' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async getTaskRepeatability(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Query('limit') limit?: number,
  ) {
    return this.repeatabilityService.getTaskRepeatability(flowId, taskId, limit || 5);
  }
}
