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
  ContinuePlaybookClarificationDto,
  EvaluateMascotToolDto,
  ListRecentExecutionsDto,
  OpenPlaybookAssistantContextDto,
  RunPlaybookFromStepDto,
  SearchPlaybooksDto,
  StartAdvisorRemediationConstructionDto,
  StartBoundPlaybookConstructionDto,
  StartPlaybookAssistantConstructionDto,
  StartPlaybookGenerationDto,
} from '../dto/playbook-assistant.dto';
import { CreatePlaybookFlowDto } from '../dto/create-playbook-flow.dto';
import { StartPlaybookFlowExecutionDto } from '../dto/start-playbook-flow-execution.dto';
import { RateLimit } from '@modules/rate-limiter';
import { PlaybookAssistantContextService } from '../assistant/playbook-assistant-context.service';
import { PlaybookAssistantService } from '../assistant/playbook-assistant.service';
import { MascotToolExecutionPolicyService } from '../assistant/mascot-tool-execution-policy.service';
import { PlaybookAssistantActorGuard } from '../guards/playbook-assistant-actor.guard';

@Public()
@ApiTags('Playbook Assistant Internal')
@Controller('internal/playbook-assistant')
@UseGuards(InternalServiceGuard, PlaybookAssistantActorGuard)
export class PlaybookAssistantInternalController {
  private readonly logger = new Logger(PlaybookAssistantInternalController.name);

  constructor(
    private readonly contextService: PlaybookAssistantContextService,
    private readonly assistantService: PlaybookAssistantService,
    private readonly mascotToolPolicy: MascotToolExecutionPolicyService,
  ) {}

  @Post('mascot/tool-policy/evaluate')
  @ApiOperation({ summary: 'Evaluate a mascot tool call in the existing runtime tool pipeline' })
  evaluateMascotTool(
    @Headers('x-yellowstorm-tenant-id') tenantId: string | undefined,
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Headers('x-yellowstorm-agent-id') agentId: string | undefined,
    @Headers('x-yellowstorm-conversation-id') conversationId: string | undefined,
    @Headers('x-correlation-id') correlationId: string | undefined,
    @Body() dto: EvaluateMascotToolDto,
  ) {
    return this.mascotToolPolicy.evaluate({
      tenantId: this.requireActorValue(tenantId, 'tenant'),
      userId: this.requireUserId(userId),
      agentId: this.requireActorValue(agentId, 'agent'),
      conversationId: this.requireActorValue(conversationId, 'conversation'),
      correlationId: this.requireActorValue(correlationId, 'correlation'),
    }, dto);
  }

  @Get('playbooks')
  @ApiOperation({ summary: 'Search accessible Playbooks for the mascot' })
  searchPlaybooks(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Query() dto: SearchPlaybooksDto,
  ) {
    return this.assistantService.searchPlaybooks(this.requireUserId(userId), dto);
  }

  @Get('executions')
  @ApiOperation({ summary: 'List recent accessible Playbook executions for the mascot' })
  listRecentExecutions(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Query() dto: ListRecentExecutionsDto,
  ) {
    return this.assistantService.listRecentExecutions(this.requireUserId(userId), dto);
  }

  @Get('executions/:executionId/diagnostics')
  @ApiOperation({ summary: 'Get redacted deterministic execution diagnostics for the mascot' })
  getExecutionDiagnostics(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Param('executionId') executionId: string,
  ) {
    return this.assistantService.getExecutionDiagnostics(executionId, this.requireUserId(userId));
  }

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

  @Post('requests/:requestId/assessment')
  @ApiOperation({ summary: 'Assess a bound Playbook assistant request' })
  assessRequest(@Headers() headers: Record<string, string | undefined>, @Param('requestId') requestId: string) {
    return this.assistantService.assessRequest(requestId, this.actor(headers));
  }

  @Post('clarifications/:continuationId')
  @ApiOperation({ summary: 'Continue a bound Playbook assistant clarification' })
  continueClarification(
    @Headers() headers: Record<string, string | undefined>,
    @Param('continuationId') continuationId: string,
    @Body() dto: ContinuePlaybookClarificationDto,
  ) {
    return this.assistantService.continueClarification(continuationId, this.actor(headers), dto);
  }

  @Post('requests/:requestId/constructions')
  @ApiOperation({ summary: 'Start one construction from a ready bound assistant request' })
  startBoundConstruction(
    @Headers() headers: Record<string, string | undefined>,
    @Param('requestId') requestId: string,
    @Body() dto: StartBoundPlaybookConstructionDto,
  ) {
    return this.assistantService.startBoundConstruction(requestId, this.actor(headers), dto.contextId);
  }

  @Post('requests/:requestId/generation')
  @ApiOperation({ summary: 'Start one operation-owned draft Playbook generation' })
  startGeneration(
    @Headers() headers: Record<string, string | undefined>,
    @Param('requestId') requestId: string,
    @Body() dto: StartPlaybookGenerationDto,
  ) {
    return this.assistantService.startGeneration(requestId, this.actor(headers), dto);
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

  private requireActorValue(value: string | undefined, name: string): string {
    const normalized = value?.trim();
    if (!normalized || normalized.length > 200) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, `Missing or invalid trusted ${name} identity`);
    }
    return normalized;
  }

  private actor(headers: Record<string, string | undefined>) {
    return {
      tenantId: this.requireActorValue(headers['x-yellowstorm-tenant-id'], 'tenant'),
      ownerId: this.requireUserId(headers['x-yellowstorm-user-id']),
      agentId: this.requireActorValue(headers['x-yellowstorm-agent-id'], 'agent'),
      conversationId: this.requireActorValue(headers['x-yellowstorm-conversation-id'], 'conversation'),
      correlationId: this.requireActorValue(headers['x-correlation-id'], 'correlation'),
    };
  }
}
