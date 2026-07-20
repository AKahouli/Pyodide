import { Body, Controller, Delete, Get, Headers, Logger, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@modules/auth/decorators/public.decorator';
import { InternalServiceGuard } from '@modules/auth/guards/internal-service.guard';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  AnalyzeTaskOptimizationDto,
  AnalyzeWorkflowOptimizationDto,
  CancelPlaybookAssistantConstructionDto,
  OpenPlaybookAssistantContextDto,
  RunPlaybookFromStepDto,
  StartAdvisorRemediationConstructionDto,
  StartPlaybookAssistantConstructionDto,
} from '../dto/playbook-assistant.dto';
import { CreatePlaybookFlowDto } from '../dto/create-playbook-flow.dto';
import { StartPlaybookFlowExecutionDto } from '../dto/start-playbook-flow-execution.dto';
import { RateLimit } from '@modules/rate-limiter';
import { PlaybookAssistantContextService } from '../assistant/playbook-assistant-context.service';
import { PlaybookAssistantService } from '../assistant/playbook-assistant.service';

@Public()
@ApiTags('Playbook Assistant Internal')
@Controller('internal/playbook-assistant')
@UseGuards(InternalServiceGuard)
export class PlaybookAssistantInternalController {
  private readonly logger = new Logger(PlaybookAssistantInternalController.name);

  constructor(
    private readonly contextService: PlaybookAssistantContextService,
    private readonly assistantService: PlaybookAssistantService,
  ) {}

  @Post('playbooks/:id/context')
  @ApiOperation({ summary: 'Open canonical Playbook assistant context' })
  openContext(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Param('id') id: string,
    @Body() dto: OpenPlaybookAssistantContextDto,
  ) {
    this.assistantService.assertEnabled();
    return this.contextService.open(id, this.requireUserId(userId), dto);
  }

  @Get('playbooks/:id/summary')
  @ApiOperation({ summary: 'Get canonical Playbook summary' })
  async getSummary(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('id') id: string) {
    this.assistantService.assertEnabled();
    const context = await this.contextService.open(id, this.requireUserId(userId));
    return { playbookId: id, definitionRevision: context.definitionRevision, workflow: context.workflow, validation: context.validation, execution: context.execution };
  }

  @Get('playbooks/:id/tasks/:taskId')
  @ApiOperation({ summary: 'Get canonical Playbook task details' })
  getTask(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('id') id: string, @Param('taskId') taskId: string) {
    this.assistantService.assertEnabled();
    return this.contextService.getTask(id, this.requireUserId(userId), taskId);
  }

  @Get('playbooks/:id/tasks/:taskId/dependencies')
  @ApiOperation({ summary: 'Get canonical Playbook task dependencies' })
  getTaskDependencies(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('id') id: string, @Param('taskId') taskId: string) {
    this.assistantService.assertEnabled();
    return this.contextService.getDependencies(id, this.requireUserId(userId), taskId);
  }

  @Get('playbooks/:id/validation')
  @ApiOperation({ summary: 'Validate canonical Playbook definition' })
  async validate(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('id') id: string) {
    this.assistantService.assertEnabled();
    const context = await this.contextService.open(id, this.requireUserId(userId));
    return { playbookId: id, definitionRevision: context.definitionRevision, ...context.validation };
  }

  @Post('playbooks/:id/constructions')
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'playbook-assistant:construction' })
  @ApiOperation({ summary: 'Start Playbook assistant construction' })
  startConstruction(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('id') id: string, @Body() dto: StartPlaybookAssistantConstructionDto) {
    return this.assistantService.startConstruction(id, this.requireUserId(userId), dto);
  }

  @Get('playbooks/:id/constructions/:operationId')
  @ApiOperation({ summary: 'Get Playbook assistant construction status' })
  getConstruction(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('id') id: string, @Param('operationId') operationId: string) {
    return this.assistantService.getConstruction(id, this.requireUserId(userId), operationId);
  }

  @Get('playbooks/:id/constructions/:operationId/events')
  @ApiOperation({ summary: 'Stream Playbook assistant construction events for an internal service' })
  async streamConstruction(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Param('id') id: string,
    @Param('operationId') operationId: string,
    @Query('after') after: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    this.assistantService.assertEnabled();
    const afterSequence = Math.max(
      Number.isFinite(Number(after)) ? Number(after) : 0,
      Number.isFinite(Number(lastEventId)) ? Number(lastEventId) : 0,
    );
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    try {
      for await (const event of this.assistantService.streamConstruction(id, this.requireUserId(userId), operationId, afterSequence)) {
        res.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Construction stream failed';
      this.logger.error(`playbook_assistant_internal_stream_failed playbookId=${id} operationId=${operationId} message=${message}`);
      if (!res.destroyed && !res.writableEnded) {
        res.write(`event: failed\ndata: ${JSON.stringify({ status: 'error', code: 'PLAYBOOK_MCP_BACKEND_UNAVAILABLE', message })}\n\n`);
      }
    }
    if (!res.destroyed && !res.writableEnded) res.end();
  }

  @Post('playbooks/:id/constructions/:operationId/cancel')
  @ApiOperation({ summary: 'Cancel Playbook assistant construction' })
  cancelConstruction(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Param('id') id: string,
    @Param('operationId') operationId: string,
    @Body() dto: CancelPlaybookAssistantConstructionDto,
  ) {
    return this.assistantService.cancelConstruction(id, this.requireUserId(userId), operationId, dto.reason);
  }

  @Post('playbooks/:id/constructions/:operationId/revert')
  @RateLimit({ limit: 5, windowMs: 60000, keyPrefix: 'playbook-assistant:revert' })
  revertConstruction(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Param('id') id: string,
    @Param('operationId') operationId: string,
  ) {
    return this.assistantService.revertConstruction(id, this.requireUserId(userId), operationId);
  }

  @Post('playbooks/:id/tasks/:taskId/optimization')
  @ApiOperation({ summary: 'Analyze a Playbook task without mutation' })
  analyzeTaskOptimization(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() dto: AnalyzeTaskOptimizationDto,
  ) {
    return this.assistantService.analyzeTaskOptimization(id, taskId, this.requireUserId(userId), dto);
  }

  @Post('playbooks/:id/advisor-remediation-constructions')
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'playbook-assistant:advisor' })
  @ApiOperation({ summary: 'Start streamed Advisor remediation construction preview' })
  startAdvisorRemediationConstruction(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Param('id') id: string,
    @Body() dto: StartAdvisorRemediationConstructionDto,
  ) {
    return this.assistantService.startAdvisorRemediationConstruction(id, this.requireUserId(userId), dto);
  }

  @Post('playbooks/:id/workflow-optimization')
  @RateLimit({ limit: 20, windowMs: 60000, keyPrefix: 'playbook-assistant:optimization' })
  analyzeWorkflowOptimization(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Param('id') id: string,
    @Body() dto: AnalyzeWorkflowOptimizationDto,
  ) {
    return this.assistantService.analyzeWorkflowOptimization(id, this.requireUserId(userId), dto);
  }

  @Post('playbooks')
  @RateLimit({ limit: 5, windowMs: 60000, keyPrefix: 'playbook-assistant:create' })
  createPlaybook(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Body() dto: CreatePlaybookFlowDto) {
    return this.assistantService.createPlaybook(this.requireUserId(userId), dto);
  }

  @Post('playbooks/:id/clone')
  @RateLimit({ limit: 5, windowMs: 60000, keyPrefix: 'playbook-assistant:clone' })
  clonePlaybook(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('id') id: string) {
    return this.assistantService.clonePlaybook(id, this.requireUserId(userId));
  }

  @Post('playbooks/:id/executions')
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'playbook-assistant:execute' })
  startExecution(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() dto: StartPlaybookFlowExecutionDto,
  ) {
    return this.assistantService.startExecution(id, this.requireUserId(userId), dto, idempotencyKey);
  }

  @Get('playbooks/:id/executions')
  listExecutions(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.assistantService.listExecutions(id, this.requireUserId(userId), Number(page) || 1, Number(limit) || 10);
  }

  @Get('executions/:executionId')
  getExecution(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('executionId') executionId: string) {
    return this.assistantService.getExecution(executionId, this.requireUserId(userId));
  }

  @Post('executions/:executionId/cancel')
  @RateLimit({ limit: 20, windowMs: 60000, keyPrefix: 'playbook-assistant:cancel-execution' })
  cancelExecution(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('executionId') executionId: string) {
    return this.assistantService.cancelExecution(executionId, this.requireUserId(userId));
  }

  @Post('executions/:executionId/trace-replay')
  traceReplayExecution(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('executionId') executionId: string) {
    return this.assistantService.traceReplayExecution(executionId, this.requireUserId(userId));
  }

  @Post('executions/:executionId/re-execute')
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'playbook-assistant:reexecute' })
  reExecute(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('executionId') executionId: string) {
    return this.assistantService.reExecute(executionId, this.requireUserId(userId));
  }

  @Post('executions/:executionId/run-from-step')
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'playbook-assistant:run-from-step' })
  runFromStep(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Param('executionId') executionId: string,
    @Body() dto: RunPlaybookFromStepDto,
  ) {
    return this.assistantService.runFromStep(executionId, this.requireUserId(userId), dto);
  }

  @Delete('executions/:executionId')
  @RateLimit({ limit: 5, windowMs: 60000, keyPrefix: 'playbook-assistant:delete-execution' })
  deleteExecution(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('executionId') executionId: string) {
    return this.assistantService.deleteExecution(executionId, this.requireUserId(userId));
  }

  private requireUserId(userId: string | undefined): string {
    const normalized = userId?.trim();
    if (!normalized) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Missing trusted user identity');
    }
    return normalized;
  }
}
