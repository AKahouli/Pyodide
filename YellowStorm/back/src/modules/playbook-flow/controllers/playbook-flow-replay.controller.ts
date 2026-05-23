import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PlaybookFlowReplayService } from '../services/playbook-flow-replay.service';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { Permissions } from '@modules/authorization/constants/permissions';

@ApiTags('Playbook Flows')
@ApiBearerAuth()
@Controller('playbooks/:id/tasks')
@UseGuards(PermissionsGuard)
export class PlaybookFlowReplayController {
  constructor(private readonly replayService: PlaybookFlowReplayService) {}

  @Post(':taskId/validate-replay')
  @ApiOperation({ summary: 'Validate task output as replay reference' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async validateTaskReplay(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Body() body: { executionId: string; iteration?: number; preserveOutputFormat?: boolean; replayConfig?: { replayOutputFormat?: boolean; replayToolTrace?: boolean; replayReasoningChain?: boolean } },
  ) {
    return this.replayService.validateTaskReplay(
      userId, flowId, taskId, body.iteration ?? 0, body.executionId,
      { preserveOutputFormat: body.preserveOutputFormat, replayConfig: body.replayConfig },
    );
  }

  @Get(':taskId/replays')
  @ApiOperation({ summary: 'List validated replays for a task' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async listTaskReplays(
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.replayService.listTaskReplays(flowId, taskId);
  }

  @Post(':taskId/replays/:replayId/activate')
  @ApiOperation({ summary: 'Activate a validated replay for a task' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async activateTaskReplay(
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Param('replayId') replayId: string,
  ) {
    return this.replayService.activateTaskReplay(flowId, taskId, replayId);
  }

  @Patch(':taskId/replays/:replayId/format-guide')
  @ApiOperation({ summary: 'Update format guide for a validated replay' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async updateTaskReplayFormatGuide(
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Param('replayId') replayId: string,
    @Body() dto: { preserveOutputFormat?: boolean; outputFormatGuide?: string; replayConfig?: { replayOutputFormat?: boolean; replayToolTrace?: boolean; replayReasoningChain?: boolean } },
  ) {
    return this.replayService.updateTaskReplayFormatGuide(flowId, taskId, replayId, dto);
  }

  @Patch(':taskId/replays/:replayId')
  @ApiOperation({ summary: 'Rename a validated replay' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async updateTaskReplayLabel(
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Param('replayId') replayId: string,
    @Body() body: { label: string },
  ) {
    return this.replayService.updateTaskReplayLabel(flowId, taskId, replayId, body.label);
  }

  @Delete(':taskId/replays/:replayId')
  @ApiOperation({ summary: 'Delete a validated replay' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async deleteTaskReplay(
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Param('replayId') replayId: string,
  ): Promise<{ removed: boolean; wasActive: boolean }> {
    return this.replayService.deleteTaskReplay(flowId, taskId, replayId);
  }
}
