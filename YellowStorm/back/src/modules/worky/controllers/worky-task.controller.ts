import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { WorkyExecutionService } from '../services/worky-execution.service';
import { WorkyHumanAssignmentService } from '../services/worky-human-assignment.service';
import { WorkyTaskResultService, WorkyTaskResultView } from '../services/worky-task-result.service';
import { WorkyTaskService } from '../services/worky-task.service';
import {
  MoveWorkyTaskDto,
  WorkyTaskControlDto,
} from '../dto/worky-task-control.dto';
import { WorkyHumanUpdateDto } from '../dto/worky-human-update.dto';
import { WorkyTaskStreamAccessGuard } from '../guards/worky-task-stream-access.guard';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { Permissions } from '../../authorization/constants/permissions';
import {
  IWorkyTaskSummary,
} from '../interfaces/worky-execution.interface';

/**
 * Per-task operational endpoints (Part 3, canonical §3.6).
 *
 *   POST /worky/tasks/{id}/move
 *   POST /worky/tasks/{id}/pause
 *   POST /worky/tasks/{id}/resume
 *   POST /worky/tasks/{id}/cancel
 *   POST /worky/tasks/{id}/review
 *
 * Access is via `WorkyTaskStreamAccessGuard` (owner of the parent stream)
 * and the `worky:stream:write` permission.
 */
@ApiTags('Worky')
@ApiBearerAuth()
@Controller('worky/tasks')
export class WorkyTaskController {
  constructor(
    private readonly execution: WorkyExecutionService,
    private readonly humanAssignment: WorkyHumanAssignmentService,
    private readonly taskResults: WorkyTaskResultService,
    private readonly taskService: WorkyTaskService,
  ) {}

  @Get(':id/results')
  @UseGuards(WorkyTaskStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  @ApiOperation({ summary: 'List generated results for a Worky task' })
  @ApiParam({ name: 'id', description: 'Task id' })
  async results(@Param('id') id: string): Promise<WorkyTaskResultView[]> {
    return this.taskResults.listForTask(id);
  }

  @Get(':id/result-content')
  @UseGuards(WorkyTaskStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  @ApiOperation({ summary: 'Rich step result content (components + file artifacts) for a Worky task' })
  @ApiParam({ name: 'id', description: 'Task id' })
  async resultContent(@Param('id') id: string) {
    return this.taskService.getResultContent(id);
  }

  @Post(':id/move')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(WorkyTaskStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Move a Worky task to a different lane' })
  @ApiParam({ name: 'id', description: 'Task id' })
  async move(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: MoveWorkyTaskDto,
  ): Promise<IWorkyTaskSummary> {
    return this.execution.moveTask(id, user._id.toString(), dto.lane, dto.reason);
  }

  @Post(':id/pause')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(WorkyTaskStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Pause a Worky task' })
  @ApiParam({ name: 'id', description: 'Task id' })
  async pause(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: WorkyTaskControlDto,
  ): Promise<IWorkyTaskSummary> {
    return this.execution.pauseTask(id, user._id.toString(), dto.reason);
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(WorkyTaskStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Resume a paused Worky task' })
  @ApiParam({ name: 'id', description: 'Task id' })
  async resume(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: WorkyTaskControlDto,
  ): Promise<IWorkyTaskSummary> {
    return this.execution.resumeTask(id, user._id.toString(), dto.reason);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(WorkyTaskStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Cancel a Worky task (not_started only)' })
  @ApiParam({ name: 'id', description: 'Task id' })
  async cancel(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: WorkyTaskControlDto,
  ): Promise<IWorkyTaskSummary> {
    return this.execution.cancelTask(id, user._id.toString(), dto.reason);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(WorkyTaskStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Move a running Worky task to review' })
  @ApiParam({ name: 'id', description: 'Task id' })
  async review(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: WorkyTaskControlDto,
  ): Promise<IWorkyTaskSummary> {
    return this.execution.reviewTask(id, user._id.toString(), dto.reason);
  }

  /**
   * Human assignee Kanban update. Validates the kind, transitions the
   * task's `executionState` + `lane`, and emits the matching SSE event
   * so the readiness evaluator re-derives the dependent DAG branch.
   * Only valid for tasks with `assigneeType === 'human_agent'`.
   */
  @Post(':id/human-update')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseGuards(WorkyTaskStreamAccessGuard)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Apply a human Kanban update to a human-assigned task' })
  @ApiParam({ name: 'id', description: 'Task id' })
  async humanUpdate(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: WorkyHumanUpdateDto,
  ): Promise<{ taskId: string; kind: string; lane: string; executionState: string }> {
    const result = await this.humanAssignment.applyHumanUpdate({
      taskId: id,
      actorUserId: user._id.toString(),
      kind: dto.kind,
      comment: dto.comment,
    });
    return {
      taskId: result.taskId,
      kind: result.kind,
      lane: result.newLane,
      executionState: result.newExecutionState,
    };
  }
}
