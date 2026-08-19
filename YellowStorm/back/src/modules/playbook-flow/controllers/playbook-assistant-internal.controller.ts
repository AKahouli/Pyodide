import { Body, Controller, Delete, Get, Headers, Logger, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '@modules/auth/decorators/public.decorator';
import { InternalServiceGuard } from '@modules/auth/guards/internal-service.guard';
import { BadRequestException, ForbiddenException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import {
  AnalyzeTaskOptimizationDto,
  AnalyzeWorkflowOptimizationDto,
  CancelPlaybookAssistantConstructionDto,
  ContinuePlaybookClarificationDto,
  ListRecentExecutionsDto,
  OpenPlaybookAssistantContextDto,
  RunCurrentTurnPlaybookModificationDto,
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
import { PlaybookAssistantActorGuard } from '../guards/playbook-assistant-actor.guard';
import { UserService } from '@modules/user';
import { AuthorizationService } from '@modules/authorization/authorization.service';
import { hasPermission, Permissions } from '@modules/authorization/constants/permissions';

@Public()
@ApiTags('Playbook Assistant Internal')
@Controller('internal/playbook-assistant')
@UseGuards(InternalServiceGuard, PlaybookAssistantActorGuard)
export class PlaybookAssistantInternalController {
  private readonly logger = new Logger(PlaybookAssistantInternalController.name);

  constructor(
    private readonly contextService: PlaybookAssistantContextService,
    private readonly assistantService: PlaybookAssistantService,
    private readonly userService: UserService,
    private readonly authorizationService: AuthorizationService,
  ) {}

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
  async startConstruction(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('id') id: string, @Body() dto: StartPlaybookAssistantConstructionDto) {
    const actingUserId = this.requireUserId(userId);
    await this.assertUserPermission(actingUserId, Permissions.PLAYBOOK_UPDATE);
    return this.assistantService.startConstruction(id, actingUserId, dto);
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
  async startBoundConstruction(
    @Headers() headers: Record<string, string | undefined>,
    @Param('requestId') requestId: string,
    @Body() dto: StartBoundPlaybookConstructionDto,
  ) {
    const actor = this.actor(headers);
    await this.assertUserPermission(actor.ownerId, Permissions.PLAYBOOK_UPDATE);
    return this.assistantService.startBoundConstruction(requestId, actor, dto.contextId);
  }

  @Post('requests/:requestId/generation')
  @ApiOperation({ summary: 'Start one operation-owned draft Playbook generation' })
  async startGeneration(
    @Headers() headers: Record<string, string | undefined>,
    @Param('requestId') requestId: string,
    @Body() dto: StartPlaybookGenerationDto,
  ) {
    const actor = this.actor(headers);
    await this.assertUserPermission(actor.ownerId, Permissions.PLAYBOOK_CREATE);
    return this.assistantService.startGeneration(requestId, actor, dto);
  }

  @Post('generation')
  @ApiOperation({ summary: 'Generate a draft Playbook from the current trusted Conversation turn' })
  async startCurrentTurnGeneration(
    @Headers() headers: Record<string, string | undefined>,
    @Body() dto: StartPlaybookGenerationDto,
  ) {
    const actor = this.actor(headers);
    await this.assertUserPermission(actor.ownerId, Permissions.PLAYBOOK_CREATE);
    return this.assistantService.startCurrentTurnGeneration(actor, dto);
  }

  @Post('playbooks/:id/current-turn/modification')
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'playbook-assistant:current-turn-modification' })
  @ApiOperation({ summary: 'Modify an existing Playbook from the current trusted Conversation turn' })
  async runCurrentTurnModification(
    @Headers() headers: Record<string, string | undefined>,
    @Param('id') id: string,
    @Body() dto: RunCurrentTurnPlaybookModificationDto,
  ) {
    const actor = this.actor(headers);
    await this.assertUserPermission(actor.ownerId, Permissions.PLAYBOOK_UPDATE);
    return this.assistantService.runCurrentTurnModification(id, actor, dto);
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
  async cancelConstruction(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Param('id') id: string,
    @Param('operationId') operationId: string,
    @Body() dto: CancelPlaybookAssistantConstructionDto,
  ) {
    const actingUserId = this.requireUserId(userId);
    await this.assertUserPermission(actingUserId, Permissions.PLAYBOOK_UPDATE);
    return this.assistantService.cancelConstruction(id, actingUserId, operationId, dto.reason);
  }

  @Post('playbooks/:id/constructions/:operationId/revert')
  @RateLimit({ limit: 5, windowMs: 60000, keyPrefix: 'playbook-assistant:revert' })
  async revertConstruction(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Param('id') id: string,
    @Param('operationId') operationId: string,
  ) {
    const actingUserId = this.requireUserId(userId);
    await this.assertUserPermission(actingUserId, Permissions.PLAYBOOK_UPDATE);
    return this.assistantService.revertConstruction(id, actingUserId, operationId);
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
  async startAdvisorRemediationConstruction(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Param('id') id: string,
    @Body() dto: StartAdvisorRemediationConstructionDto,
  ) {
    const actingUserId = this.requireUserId(userId);
    await this.assertUserPermission(actingUserId, Permissions.PLAYBOOK_UPDATE);
    return this.assistantService.startAdvisorRemediationConstruction(id, actingUserId, dto);
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
  async createPlaybook(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Body() dto: CreatePlaybookFlowDto) {
    const actingUserId = this.requireUserId(userId);
    await this.assertUserPermission(actingUserId, Permissions.PLAYBOOK_CREATE);
    return this.assistantService.createPlaybook(actingUserId, dto);
  }

  @Post('playbooks/:id/clone')
  @RateLimit({ limit: 5, windowMs: 60000, keyPrefix: 'playbook-assistant:clone' })
  async clonePlaybook(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('id') id: string) {
    const actingUserId = this.requireUserId(userId);
    await this.assertUserPermission(actingUserId, Permissions.PLAYBOOK_CREATE);
    return this.assistantService.clonePlaybook(id, actingUserId);
  }

  @Post('playbooks/:id/executions')
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'playbook-assistant:execute' })
  async startExecution(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('id') id: string,
    @Body() dto: StartPlaybookFlowExecutionDto,
  ) {
    const actingUserId = this.requireUserId(userId);
    await this.assertUserPermission(actingUserId, Permissions.PLAYBOOK_EXECUTE);
    return this.assistantService.startExecution(id, actingUserId, dto, idempotencyKey);
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
  async cancelExecution(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('executionId') executionId: string) {
    const actingUserId = this.requireUserId(userId);
    await this.assertUserPermission(actingUserId, Permissions.PLAYBOOK_EXECUTE);
    return this.assistantService.cancelExecution(executionId, actingUserId);
  }

  @Post('executions/:executionId/trace-replay')
  async traceReplayExecution(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('executionId') executionId: string) {
    const actingUserId = this.requireUserId(userId);
    await this.assertUserPermission(actingUserId, Permissions.PLAYBOOK_EXECUTE);
    return this.assistantService.traceReplayExecution(executionId, actingUserId);
  }

  @Post('executions/:executionId/re-execute')
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'playbook-assistant:reexecute' })
  async reExecute(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('executionId') executionId: string) {
    const actingUserId = this.requireUserId(userId);
    await this.assertUserPermission(actingUserId, Permissions.PLAYBOOK_EXECUTE);
    return this.assistantService.reExecute(executionId, actingUserId);
  }

  @Post('executions/:executionId/run-from-step')
  @RateLimit({ limit: 10, windowMs: 60000, keyPrefix: 'playbook-assistant:run-from-step' })
  async runFromStep(
    @Headers('x-yellowstorm-user-id') userId: string | undefined,
    @Param('executionId') executionId: string,
    @Body() dto: RunPlaybookFromStepDto,
  ) {
    const actingUserId = this.requireUserId(userId);
    await this.assertUserPermission(actingUserId, Permissions.PLAYBOOK_EXECUTE);
    return this.assistantService.runFromStep(executionId, actingUserId, dto);
  }

  @Delete('executions/:executionId')
  @RateLimit({ limit: 5, windowMs: 60000, keyPrefix: 'playbook-assistant:delete-execution' })
  async deleteExecution(@Headers('x-yellowstorm-user-id') userId: string | undefined, @Param('executionId') executionId: string) {
    const actingUserId = this.requireUserId(userId);
    await this.assertUserPermission(actingUserId, Permissions.PLAYBOOK_EXECUTE);
    return this.assistantService.deleteExecution(executionId, actingUserId);
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

  private async assertUserPermission(userId: string, permission: string): Promise<void> {
    const user = await this.userService.findById(userId);
    const permissions = user
      ? await this.authorizationService.getUserPermissions(user.roles ?? [])
      : [];
    if (!hasPermission(permissions, permission)) {
      throw new ForbiddenException(
        ErrorCode.FORBIDDEN,
        'The authenticated user cannot perform this Playbook action',
      );
    }
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
