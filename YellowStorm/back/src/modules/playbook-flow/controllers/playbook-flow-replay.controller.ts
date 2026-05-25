import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PlaybookFlowReplayService } from '../services/playbook-flow-replay.service';
import { PlaybookFlowReplayDriftService } from '../services/playbook-flow-replay-drift.service';
import { PlaybookFlowReplayReportService } from '../services/playbook-flow-replay-report.service';
import { PlaybookFlowService } from '../services/playbook-flow.service';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { Permissions } from '@modules/authorization/constants/permissions';
import { ValidateTaskReplayDto } from '../dto/validate-task-replay.dto';
import { UpdateTaskReplayFormatGuideDto } from '../dto/update-task-replay-format-guide.dto';
import { ListReplayReportsQueryDto } from '../dto/list-replay-reports-query.dto';
import { UpdateTaskReplayLabelDto } from '../dto/update-task-replay-label.dto';
import type {
  UpdateReplayFormatGuidePayload,
  ValidateTaskReplayOptions,
} from '../services/playbook-flow-replay.service';

@ApiTags('Playbook Flows')
@ApiBearerAuth()
@Controller('playbooks/:id/tasks')
@UseGuards(PermissionsGuard)
export class PlaybookFlowReplayController {
  constructor(
    private readonly replayService: PlaybookFlowReplayService,
    private readonly replayDriftService: PlaybookFlowReplayDriftService,
    private readonly replayReportService: PlaybookFlowReplayReportService,
    private readonly flowService: PlaybookFlowService,
  ) {}

  @Post(':taskId/validate-replay')
  @ApiOperation({ summary: 'Validate task output as replay reference' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async validateTaskReplay(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Body() body: ValidateTaskReplayDto,
  ) {
    await this.flowService.findOne(flowId, userId);
    return this.replayService.validateTaskReplay(
      userId, flowId, taskId, body.iteration ?? 0, body.executionId,
      { preserveOutputFormat: body.preserveOutputFormat, mode: body.mode, replayConfig: body.replayConfig } as ValidateTaskReplayOptions,
    );
  }

  @Get(':taskId/replays')
  @ApiOperation({ summary: 'List validated replays for a task' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async listTaskReplays(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
  ) {
    await this.flowService.findOne(flowId, userId);
    return this.replayService.listTaskReplays(flowId, taskId);
  }

  @Get(':taskId/replay-reports')
  @ApiOperation({ summary: 'List replay run reports for a task' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async listReplayReports(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Query() query: ListReplayReportsQueryDto,
  ) {
    await this.flowService.findOne(flowId, userId);
    if (query.executionId && typeof query.iteration === 'number') {
      await this.replayDriftService.ensureIterationReportMaterialized(query.executionId, taskId, query.iteration);
    }
    const reports = await this.replayReportService.listReports({
      flowId,
      taskId,
      executionId: query.executionId,
      iteration: query.iteration,
      limit: query.limit,
      offset: query.offset,
    });
    return reports;
  }

  @Post(':taskId/replays/:replayId/activate')
  @ApiOperation({ summary: 'Activate a validated replay for a task' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async activateTaskReplay(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Param('replayId') replayId: string,
  ) {
    await this.flowService.findOne(flowId, userId);
    return this.replayService.activateTaskReplay(flowId, taskId, replayId);
  }

  @Patch(':taskId/replays/:replayId/format-guide')
  @ApiOperation({ summary: 'Update format guide for a validated replay' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async updateTaskReplayFormatGuide(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Param('replayId') replayId: string,
    @Body() dto: UpdateTaskReplayFormatGuideDto,
  ) {
    await this.flowService.findOne(flowId, userId);
    return this.replayService.updateTaskReplayFormatGuide(flowId, taskId, replayId, dto as UpdateReplayFormatGuidePayload);
  }

  @Patch(':taskId/replays/:replayId')
  @ApiOperation({ summary: 'Rename a validated replay' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async updateTaskReplayLabel(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Param('replayId') replayId: string,
    @Body() body: UpdateTaskReplayLabelDto,
  ) {
    await this.flowService.findOne(flowId, userId);
    return this.replayService.updateTaskReplayLabel(flowId, taskId, replayId, body.label ?? null);
  }

  @Delete(':taskId/replays/:replayId')
  @ApiOperation({ summary: 'Delete a validated replay' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async deleteTaskReplay(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Param('replayId') replayId: string,
  ): Promise<{ removed: boolean; wasActive: boolean }> {
    await this.flowService.findOne(flowId, userId);
    return this.replayService.deleteTaskReplay(flowId, taskId, replayId);
  }
}
