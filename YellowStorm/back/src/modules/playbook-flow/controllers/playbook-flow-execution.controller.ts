import {
  Controller, Get, Post, Delete, Param, Body, Query, UseGuards, Headers, HttpException, HttpStatus, NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { PlaybookFlowExecutionService } from '../services/playbook-flow-execution.service';
import { PlaybookFlowArtifactService } from '../services/playbook-flow-artifact.service';
import { PlaybookFlowReplayService } from '../services/playbook-flow-replay.service';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { Permissions } from '@modules/authorization/constants/permissions';
import { StartPlaybookFlowExecutionDto } from '../dto/start-playbook-flow-execution.dto';
import { ResumePlaybookFlowApprovalDto } from '../dto/resume-playbook-flow-approval.dto';
import { RequestPlaybookArtifactAccessDto } from '../dto/request-playbook-artifact-access.dto';
import type { AdvisorScoringMode } from '../schemas/playbook-flow.schema';

@ApiTags('Playbook Flow Executions')
@ApiBearerAuth()
@Controller()
@UseGuards(PermissionsGuard)
export class PlaybookFlowExecutionController {
  constructor(
    private readonly executionService: PlaybookFlowExecutionService,
    private readonly replayService: PlaybookFlowReplayService,
    private readonly artifactService: PlaybookFlowArtifactService,
  ) {}

  private async ensureExecutionBelongsToFlow(executionId: string, flowId: string, userId: string) {
    const execution = await this.executionService.findOne(executionId, userId);
    if (execution.flowId !== flowId) {
      throw new NotFoundException('Execution not found');
    }
    return execution;
  }

  @Post('playbooks/:flowId/executions')
  @ApiOperation({ summary: 'Start a playbook flow execution' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async start(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Body() body: StartPlaybookFlowExecutionDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const singleStepTaskId: string | undefined = body.singleStepTaskId;
    const executionMode: string | undefined = body.executionMode;
    const stepExecutionModes: Record<string, string> | undefined = body.stepExecutionModes;
    const advisorAutopilotEnabled: boolean | undefined = body.advisorAutopilotEnabled;
    const advisorAutopilotTargetScore: number | undefined = body.advisorAutopilotTargetScore;
    const advisorAutopilotMaxTurns: number | undefined = body.advisorAutopilotMaxTurns;
    const reflectionEnabled: boolean | undefined = body.reflectionEnabled;
    const advisorScoringMode: AdvisorScoringMode | undefined = body.advisorScoringMode;
    const modelIdOverride: string | undefined = body.modelIdOverride;
    const execution = await this.executionService.start(
      flowId, userId, body.inputContext, idempotencyKey, singleStepTaskId,
      advisorAutopilotEnabled, advisorAutopilotTargetScore, advisorAutopilotMaxTurns, reflectionEnabled, advisorScoringMode,
      executionMode, stepExecutionModes, modelIdOverride,
    );
    return { executionId: (execution as any).id ?? (execution as any)._id?.toString() };
  }

  @Get('playbooks/:flowId/executions')
  @ApiOperation({ summary: 'List executions for a flow' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async findAll(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.executionService.findAll(flowId, userId, page || 1, limit || 10);
  }

  @Get('executions/:executionId')
  @ApiOperation({ summary: 'Get execution detail with task results and router decisions' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async findOne(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executionService.findOne(executionId, userId);
  }

  @Post('executions/:executionId/artifacts/:artifactId/access')
  @ApiOperation({ summary: 'Issue scoped access to a playbook artifact' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async artifactAccess(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
    @Param('artifactId') artifactId: string,
    @Body() body: RequestPlaybookArtifactAccessDto,
  ) {
    return this.artifactService.issueAccess(executionId, artifactId, userId, body.action);
  }

  @Post('executions/:executionId/cancel')
  @ApiOperation({ summary: 'Cancel a running execution' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async cancel(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executionService.cancel(executionId, userId);
  }

  @Post('executions/:executionId/resume-approval')
  @ApiOperation({ summary: 'Resume a pending-approval execution' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async resumeApproval(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
    @Body() body: ResumePlaybookFlowApprovalDto,
  ) {
    return this.executionService.resumeApproval(executionId, userId, body);
  }

  @Post('executions/:executionId/trace-replay')
  @ApiOperation({ summary: 'Trace replay an execution deterministically from recorded events' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async traceReplay(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.replayService.traceReplay(executionId, userId);
  }

  @Post('executions/:executionId/re-execute')
  @ApiOperation({ summary: 'Re-execute a flow with the same inputs (may diverge)' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async reExecute(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.replayService.reExecute(executionId, userId);
  }

  @Delete('executions/:executionId')
  @ApiOperation({ summary: 'Delete a single execution and its associated records' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async delete(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
  ) {
    await this.executionService.delete(executionId, userId);
    return { deleted: true };
  }

  @Delete('playbooks/:flowId/executions')
  @ApiOperation({ summary: 'Delete all executions for a flow' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async deleteAll(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
  ) {
    return this.executionService.deleteAll(flowId, userId);
  }

  @Get('executions/:executionId/router-decisions')
  @ApiOperation({ summary: 'Get router decisions for trace replay' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async getRouterDecisions(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
  ) {
    const detail = await this.executionService.findOne(executionId, userId);
    return detail.routerDecisions;
  }

  // --- Execution compat routes (old playbook API surfaces) ---

  @Post('playbooks/:flowId/resume')
  @ApiOperation({ summary: 'Resume a paused execution (compat)' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async compatResume(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Body() body: { executionId: string },
  ) {
    await this.ensureExecutionBelongsToFlow(body.executionId, flowId, userId);
    return this.executionService.resumeApproval(body.executionId, userId, { decision: 'approved' });
  }

  @Post('playbooks/:flowId/stop')
  @ApiOperation({ summary: 'Stop/cancel execution (compat)' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async compatStop(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Body() body: { executionId: string },
  ) {
    await this.ensureExecutionBelongsToFlow(body.executionId, flowId, userId);
    return this.executionService.cancel(body.executionId, userId);
  }

  @Post('playbooks/:flowId/steps/skip')
  @ApiOperation({ summary: 'Skip a step mid-execution (not yet implemented)' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async compatSkipStep(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Body() body: { executionId: string; taskId: string },
  ) {
    throw new HttpException('Step skipping is not available in this version', HttpStatus.NOT_IMPLEMENTED);
  }

  @Post('playbooks/:flowId/executions/:executionId/run-from-step')
  @ApiOperation({ summary: 'Run a new execution from a completed step' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async runFromStep(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Param('executionId') executionId: string,
    @Body() body: { taskId: string; iteration?: number },
  ) {
    await this.ensureExecutionBelongsToFlow(executionId, flowId, userId);
    const execution = await this.executionService.runFromStep(executionId, userId, {
      taskId: body.taskId,
      iteration: body.iteration,
    });
    return { executionId: (execution as any).id ?? executionId };
  }

  @Post('playbooks/:flowId/executions/:executionId/resume-from-step')
  @ApiOperation({ summary: 'Resume execution from a step' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async compatResumeFromStep(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Param('executionId') executionId: string,
    @Body() body: {
      taskId: string;
      streaming?: boolean;
      action?: string;
      interruptId?: string;
      iteration?: number;
      message?: string;
      approved?: boolean;
      reason?: string;
      feedback?: string;
      scope?: string;
      remember?: boolean;
      payload?: Record<string, unknown>;
    },
  ) {
    const execution = await this.ensureExecutionBelongsToFlow(executionId, flowId, userId);
    const resumed = await this.executionService.resumeFromStep(executionId, userId, {
      taskId: body.taskId,
      streaming: body.streaming,
      action: body.action,
      interruptId: body.interruptId,
      iteration: body.iteration,
      message: body.message,
      approved: body.approved,
      reason: body.reason,
      feedback: body.feedback,
      scope: body.scope,
      remember: body.remember,
      payload: body.payload,
    });
    return {
      status: resumed.status,
      executionId: (resumed as any).id ?? execution.id,
    };
  }

  @Get('playbooks/:flowId/executions/:executionId')
  @ApiOperation({ summary: 'Get execution detail nested under playbook (compat)' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async compatGetExecution(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.ensureExecutionBelongsToFlow(executionId, flowId, userId);
  }

  @Delete('playbooks/:flowId/executions/:executionId')
  @ApiOperation({ summary: 'Delete execution nested under playbook (compat)' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async compatDeleteExecution(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Param('executionId') executionId: string,
  ) {
    await this.ensureExecutionBelongsToFlow(executionId, flowId, userId);
    await this.executionService.delete(executionId, userId);
    return { deleted: true };
  }

  @Delete('playbooks/:flowId/executions/:executionId/tasks/:taskId/step-executions/:stepExecutionId')
  @ApiOperation({ summary: 'Delete a step-execution record (not yet implemented)' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async compatDeleteStepExecution(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Param('executionId') executionId: string,
    @Param('taskId') taskId: string,
    @Param('stepExecutionId') stepExecutionId: string,
  ) {
    throw new HttpException('Step execution deletion is not available in this version', HttpStatus.NOT_IMPLEMENTED);
  }
}
