import { Controller, Get, Post, Put, Patch, Delete, Param, Body, Query, UseGuards, Logger, Res, Headers, DefaultValuePipe, ParseIntPipe } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PlaybookFlowService } from '../services/playbook-flow.service';
import { PlaybookFlowDesignService } from '../services/playbook-flow-design.service';
import { PlaybookFlowDesignOperationService } from '../services/playbook-flow-design-operation.service';
import { PlaybookFlowEvaluationService } from '../services/playbook-flow-evaluation.service';
import { PlaybookFlowIntentService } from '../services/playbook-flow-intent.service';
import { PlaybookFlowIntentConstructionService } from '../services/playbook-flow-intent-construction.service';
import { CreatePlaybookFlowDto } from '../dto/create-playbook-flow.dto';
import { PatchPlaybookFlowDeltaDto } from '../dto/patch-playbook-flow-delta.dto';
import { UpdatePlaybookFlowDto } from '../dto/update-playbook-flow.dto';
import { PlaybookFlowQueryDto } from '../dto/playbook-flow-query.dto';
import { RequestPlaybookFlowIntentDto } from '../dto/request-playbook-flow-intent.dto';
import { CancelIntentConstructionDto } from '../dto/cancel-intent-construction.dto';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { Permissions } from '@modules/authorization/constants/permissions';
import { SystemService } from '@modules/system/system.service';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { PlaybookAssistantService } from '../assistant/playbook-assistant.service';
import { ChoosePlaybookClarificationSourcesDto, InitializePlaybookAssistantAttachmentDto, RunPlaybookAssistantTurnDto, StartAdvisorRemediationConstructionDto } from '../dto/playbook-assistant.dto';
import { PlaybookAssistantSourcesService } from '../assistant/playbook-assistant-sources.service';
import { RateLimit } from '@modules/rate-limiter';
import { PlaybookInputContractService } from '../services/playbook-input-contract.service';
import { PlaybookFlowArtifactService } from '../services/playbook-flow-artifact.service';
import { FlowAccessService } from '../domain/flow-access.service';

@ApiTags('Playbook Flows')
@ApiBearerAuth()
@Controller('playbooks')
@UseGuards(PermissionsGuard)
export class PlaybookFlowController {
  private readonly logger = new Logger(PlaybookFlowController.name);

  constructor(
    private readonly playbookFlowService: PlaybookFlowService,
    private readonly designService: PlaybookFlowDesignService,
    private readonly designOperationService: PlaybookFlowDesignOperationService,
    private readonly evaluationService: PlaybookFlowEvaluationService,
    private readonly playbookFlowIntentService: PlaybookFlowIntentService,
    private readonly playbookFlowIntentConstructionService: PlaybookFlowIntentConstructionService,
    private readonly playbookAssistantService: PlaybookAssistantService,
    private readonly playbookAssistantSourcesService: PlaybookAssistantSourcesService,
    private readonly playbookInputContractService: PlaybookInputContractService,
    private readonly artifactService: PlaybookFlowArtifactService,
    private readonly systemService: SystemService,
    private readonly accessService: FlowAccessService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new playbook flow' })
  @RequirePermissions(Permissions.PLAYBOOK_CREATE)
  async create(
    @CurrentUser('_id') userId: string,
    @Body() dto: CreatePlaybookFlowDto,
  ) {
    return this.playbookFlowService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List playbook flows' })
  async findAll(
    @CurrentUser('_id') userId: string,
    @Query() query: PlaybookFlowQueryDto,
  ) {
    return this.playbookFlowService.findAll(userId, query);
  }

  @Get('active-executions')
  @ApiOperation({ summary: 'List active executions across playbooks' })
  async getActiveExecutions(
    @CurrentUser('_id') userId: string,
  ) {
    return this.playbookFlowService.getActiveExecutions(userId);
  }

  @Get('recent-artifacts')
  @ApiOperation({ summary: 'List recent accessible generated artifacts' })
  async recentArtifacts(
    @CurrentUser('_id') userId: string,
    @Query('limit', new DefaultValuePipe(6), ParseIntPipe) limit: number,
  ) {
    return this.artifactService.listRecent(userId, Math.min(Math.max(limit, 1), 20));
  }

  @Get('assistant/source-files')
  @ApiOperation({ summary: 'Find files by name across every workspace the user can open, to choose a playbook source' })
  searchAssistantSourceFiles(
    @CurrentUser('_id') userId: string,
    @Query('search') search = '',
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
  ) {
    return this.playbookAssistantSourcesService.searchFiles(userId, search, Math.max(page, 1));
  }

  @Get('assistant/pending-sources')
  @ApiOperation({ summary: 'The Yellowmind source questions still waiting on a change to this playbook' })
  getAssistantPendingSources(
    @CurrentUser('_id') userId: string,
    @Query('playbookId') playbookId = '',
  ) {
    return this.playbookAssistantSourcesService.pendingForPlaybook(userId, playbookId);
  }

  @Get('assistant/clarifications/:continuationId/sources')
  @ApiOperation({ summary: 'The source questions the assistant is waiting on, and what the user chose for them' })
  getAssistantClarificationSources(
    @CurrentUser('_id') userId: string,
    @Param('continuationId') continuationId: string,
  ) {
    return this.playbookAssistantSourcesService.getSources(userId, continuationId);
  }

  @Put('assistant/clarifications/:continuationId/questions/:questionId/sources')
  @ApiOperation({ summary: 'Choose the workspaces or files for one source question, or skip it' })
  chooseAssistantClarificationSources(
    @CurrentUser('_id') userId: string,
    @Param('continuationId') continuationId: string,
    @Param('questionId') questionId: string,
    @Body() dto: ChoosePlaybookClarificationSourcesDto,
  ) {
    return this.playbookAssistantSourcesService.choose(userId, continuationId, questionId, dto);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a playbook flow by id' })
  async findOne(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Query('view') view?: 'base' | 'enriched',
  ) {
    if (view === 'base') {
      return this.playbookFlowService.findOneBase(id, userId);
    }
    return this.playbookFlowService.findOneEnriched(id, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a playbook flow' })
  async update(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePlaybookFlowDto,
  ) {
    const payloadBytes = Buffer.byteLength(JSON.stringify(dto), 'utf8');
    this.logger.log(`playbook_autosave_payload_bytes mode=full playbookId=${id} payloadBytes=${payloadBytes}`);
    return this.playbookFlowService.update(id, userId, dto);
  }

  @Patch(':id/delta')
  @ApiOperation({ summary: 'Apply a delta patch to a playbook flow' })
  async patchDelta(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Body() dto: PatchPlaybookFlowDeltaDto,
  ) {
    if (!(await this.systemService.getPlaybookSettings()).playbookExecution.deltaPatchEnabled) {
      throw new BadRequestException(ErrorCode.BAD_REQUEST, 'Playbook delta patch is disabled.');
    }

    const payloadBytes = Buffer.byteLength(JSON.stringify(dto), 'utf8');
    this.logger.log(`playbook_autosave_payload_bytes mode=delta playbookId=${id} payloadBytes=${payloadBytes}`);
    return this.playbookFlowService.applyDeltaPatch(id, userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a playbook flow' })
  @RequirePermissions(Permissions.PLAYBOOK_DELETE)
  async remove(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
  ) {
    return this.playbookFlowService.remove(id, userId);
  }

  @Post('generate')
  @ApiOperation({ summary: 'Generate a new playbook flow from a prompt' })
  @RequirePermissions(Permissions.PLAYBOOK_CREATE)
  async generateFlow(
    @CurrentUser('_id') userId: string,
    @Body() body: { name: string; prompt: string; workspaceIds?: string[] },
  ) {
    return this.designService.generateFlow(userId, body.name, body.prompt, body.workspaceIds ?? []);
  }

  @Post('rewrite-prompt')
  @ApiOperation({ summary: 'Rewrite a playbook generation prompt' })
  @RequirePermissions(Permissions.PLAYBOOK_CREATE)
  async rewritePrompt(
    @CurrentUser('_id') userId: string,
    @Body() body: { prompt: string },
  ) {
    return this.designService.rewritePrompt(userId, body.prompt);
  }

  @Post(':id/design')
  @ApiOperation({ summary: 'Design/refine an existing playbook flow' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async designFlow(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Body() body: { query: string },
  ) {
    return this.designService.designFlow(userId, id, body.query);
  }

  @Post(':id/design-operations')
  @ApiOperation({ summary: 'Queue an asynchronous playbook design operation' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async startDesignOperation(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Body() body: { query: string; idempotencyKey?: string },
  ) {
    return this.designOperationService.enqueue(userId, id, body.query, body.idempotencyKey);
  }

  @Get(':id/design-operations/:operationId')
  @ApiOperation({ summary: 'Get an asynchronous playbook design operation' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async getDesignOperation(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Param('operationId') operationId: string,
  ) {
    return this.designOperationService.findOne(userId, id, operationId);
  }

  @Post(':id/design-operations/:operationId/cancel')
  @ApiOperation({ summary: 'Cancel a queued asynchronous playbook design operation' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async cancelDesignOperation(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Param('operationId') operationId: string,
  ) {
    return this.designOperationService.cancel(userId, id, operationId);
  }

  @Post(':id/clone')
  @ApiOperation({ summary: 'Clone a playbook flow' })
  @RequirePermissions(Permissions.PLAYBOOK_CREATE)
  async cloneFlow(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
  ) {
    return this.playbookFlowService.clone(id, userId);
  }

  @Get(':id/evaluations')
  @ApiOperation({ summary: 'List evaluation executions for a flow' })
  async listEvaluations(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Query('taskId') taskId?: string,
  ) {
    await this.accessService.assertExecutionAccess(flowId, userId, 'read');
    return this.evaluationService.listEvaluationExecutions(flowId, taskId);
  }

  @Get(':id/evaluation-tasks/:taskId/baseline')
  @ApiOperation({ summary: 'Get active evaluation baseline for a task' })
  async getBaseline(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Query('iteration') iteration?: number,
  ) {
    await this.accessService.assertExecutionAccess(flowId, userId, 'read');
    return this.evaluationService.getActiveBaseline(flowId, taskId, iteration);
  }

  @Post(':id/evaluation-tasks/:taskId/baseline/from-execution')
  @ApiOperation({ summary: 'Create evaluation baseline from an execution' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async createBaselineFromExecution(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Body() body: { executionId: string; iteration?: number },
  ) {
    return this.evaluationService.replaceBaselineFromExecution(
      flowId, taskId, body.iteration ?? 0, body.executionId, userId,
    );
  }

  @Post(':id/evaluation-tasks/:taskId/baseline/from-current-execution')
  @ApiOperation({ summary: 'Create evaluation baseline from current evaluation execution' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async createBaselineFromCurrentExecution(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Body() body: { executionId: string; evaluationExecutionId: string; iteration?: number },
  ) {
    return this.evaluationService.replaceBaselineFromCurrentEvaluationExecution(
      flowId, taskId, body.iteration ?? 0, body.executionId, body.evaluationExecutionId, userId,
    );
  }

  @Delete(':id/evaluation-tasks/:taskId/baseline')
  @ApiOperation({ summary: 'Delete evaluation baseline for a task' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async deleteBaseline(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
  ) {
    await this.evaluationService.removeActiveBaseline(flowId, taskId);
  }

  @Get(':id/design-messages')
  @ApiOperation({ summary: 'Get design message history for a flow' })
  async getDesignMessages(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
  ) {
    return this.designService.getDesignMessages(id, userId);
  }

  @Post(':id/design-messages')
  @ApiOperation({ summary: 'Append a design message history entry for a flow' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async appendDesignMessage(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Body() body: { userQuery: string; aiSummary: string; status?: 'completed' | 'failed'; error?: string | null },
  ) {
    return this.designService.appendDesignMessage(id, userId, body);
  }

  @Delete(':id/design-messages')
  @ApiOperation({ summary: 'Clear design message memory for the current user' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async clearDesignMessages(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
  ) {
    return this.designService.clearDesignMessages(id, userId);
  }

  @Post(':id/design-messages/:msgId/revert')
  @ApiOperation({ summary: 'Revert flow to a prior design snapshot' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async revertDesign(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Param('msgId') msgId: string,
  ) {
    return this.designService.revertToSnapshot(id, msgId, userId);
  }

  @Post(':id/favorite')
  @ApiOperation({ summary: 'Toggle favorite status on a playbook' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async toggleFavorite(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
  ) {
    return this.playbookFlowService.toggleFavorite(id, userId);
  }

  @Post('bulk-delete')
  @ApiOperation({ summary: 'Delete multiple playbooks' })
  @RequirePermissions(Permissions.PLAYBOOK_DELETE)
  async bulkDelete(
    @CurrentUser('_id') userId: string,
    @Body() body: { ids: string[] },
  ) {
    return this.playbookFlowService.bulkDelete(body.ids, userId);
  }

  @Post(':id/clone-share')
  @ApiOperation({ summary: 'Clone and share a playbook' })
  @RequirePermissions(Permissions.PLAYBOOK_CREATE)
  async cloneShare(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Body() body: { emails: string[] },
  ) {
    return this.playbookFlowService.cloneShare(id, userId, body.emails);
  }

  // Note: integration-link and public-execute endpoints are deferred to a future integration-token service slice with durable storage.

  @Post(':id/intent-design')
  @ApiOperation({ summary: 'Assess playbook intent requirements before manual generation' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async assessIntentDesign(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Body() dto: RequestPlaybookFlowIntentDto,
  ) {
    return this.playbookFlowIntentService.assessDesign(id, userId, dto);
  }

  @Get(':id/intent-traces')
  @ApiOperation({ summary: 'Get the last LLM traces for intent.analyze and intent.design_assessment prompts on this playbook.' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async getIntentTraces(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
  ) {
    return this.playbookFlowIntentService.getIntentTraces(id, userId);
  }

  @Post(':id/intent-constructions')
  @ApiOperation({ summary: 'Start realtime playbook intent construction' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async startIntentConstruction(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Body() dto: RequestPlaybookFlowIntentDto,
  ) {
    return this.playbookFlowIntentConstructionService.start(id, userId, dto);
  }

  @Get(':id/intent-constructions/:constructionId/stream')
  @ApiOperation({ summary: 'Stream realtime playbook intent construction events' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async streamIntentConstruction(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Param('constructionId') constructionId: string,
    @Query('after') after: string | undefined,
    @Headers('last-event-id') lastEventId: string | undefined,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    const afterSequence = Math.max(
      Number.isFinite(Number(after)) ? Number(after) : 0,
      Number.isFinite(Number(lastEventId)) ? Number(lastEventId) : 0,
    );
    try {
      for await (const event of this.playbookFlowIntentConstructionService.stream(id, userId, constructionId, afterSequence)) {
        res.write(`id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Intent construction stream failed.';
      this.logger.error(`playbook_intent_construction_stream_failed playbookId=${id} constructionId=${constructionId} message=${message}`);
      if (!res.destroyed && !res.writableEnded) {
        res.write(`event: failed\ndata: ${JSON.stringify({
          type: 'failed',
          constructionId,
          playbookId: id,
          sequence: afterSequence + 1,
          createdAt: new Date().toISOString(),
          message,
          recoverable: true,
        })}\n\n`);
      }
    }
    if (!res.destroyed && !res.writableEnded) {
      res.end();
    }
  }

  @Post(':id/intent-constructions/:constructionId/cancel')
  @ApiOperation({ summary: 'Cancel realtime playbook intent construction' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async cancelIntentConstruction(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Param('constructionId') constructionId: string,
    @Body() body: CancelIntentConstructionDto,
  ) {
    return this.playbookFlowIntentConstructionService.cancel(id, userId, constructionId, body?.reason);
  }

  @Get(':id/input-contract')
  @ApiOperation({ summary: 'Get the derived Playbook input contract' })
  async getInputContract(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
  ) {
    const flow = await this.playbookFlowService.findOneBase(id, userId);
    return this.playbookInputContractService.derive(flow);
  }

  @Post(':id/assistant/turns')
  @ApiOperation({ summary: 'Run a Playbook Designer turn through the dedicated MCP assistant' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async runAssistantTurn(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Body() dto: RunPlaybookAssistantTurnDto,
  ) {
    return this.playbookAssistantService.runTurn(id, userId, dto);
  }

  @Post(':id/assistant/attachments')
  @ApiOperation({ summary: 'Initialize a trusted Playbook assistant image upload' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  @RateLimit({ limit: 20, windowMs: 60000, keyPrefix: 'playbook-assistant:attachment-init' })
  initializeAssistantAttachment(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Body() dto: InitializePlaybookAssistantAttachmentDto,
  ) {
    return this.playbookAssistantService.initializeAttachment(id, userId, dto);
  }

  @Post(':id/assistant/attachments/:attachmentId/confirm')
  @ApiOperation({ summary: 'Confirm and verify a Playbook assistant image upload' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  @RateLimit({ limit: 20, windowMs: 60000, keyPrefix: 'playbook-assistant:attachment-confirm' })
  confirmAssistantAttachment(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Param('attachmentId') attachmentId: string,
  ) {
    return this.playbookAssistantService.confirmAttachment(id, userId, attachmentId);
  }

  @Get(':id/assistant/messages')
  @ApiOperation({ summary: 'List server-owned Playbook assistant conversation messages' })
  listAssistantMessages(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Query('conversationId') conversationId?: string,
  ) {
    return this.playbookAssistantService.listHistory(id, userId, conversationId);
  }

  @Post(':id/advisor-remediation-constructions')
  @ApiOperation({ summary: 'Start an Advisor remediation construction preview' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async startAdvisorRemediationConstruction(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Body() dto: StartAdvisorRemediationConstructionDto,
  ) {
    return this.playbookAssistantService.startAdvisorRemediationConstruction(id, userId, dto);
  }

  @Get(':id/intent-constructions/:constructionId')
  @ApiOperation({ summary: 'Get assistant construction status and disposition' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async getIntentConstruction(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Param('constructionId') constructionId: string,
  ) {
    return this.playbookFlowIntentConstructionService.getStatus(id, userId, constructionId);
  }

  @Post(':id/intent-constructions/:constructionId/commit')
  @ApiOperation({ summary: 'Commit a completed assistant construction at its base revision' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async commitIntentConstruction(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Param('constructionId') constructionId: string,
    @Body() dto: UpdatePlaybookFlowDto,
  ) {
    return this.playbookFlowIntentConstructionService.commit(id, userId, constructionId, dto);
  }


  @Post(':id/intent-constructions/:constructionId/apply')
  @ApiOperation({ summary: 'Apply a completed Advisor construction preview' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async applyIntentConstructionPreview(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Param('constructionId') constructionId: string,
    @Body() dto: UpdatePlaybookFlowDto,
  ) {
    return this.playbookFlowIntentConstructionService.applyPreview(id, userId, constructionId, dto);
  }

  @Post(':id/intent-constructions/:constructionId/discard')
  @ApiOperation({ summary: 'Discard a completed Advisor construction preview' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async discardIntentConstructionPreview(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Param('constructionId') constructionId: string,
  ) {
    return this.playbookFlowIntentConstructionService.discardPreview(id, userId, constructionId);
  }

  @Post(':id/intent-constructions/:constructionId/revert')
  @ApiOperation({ summary: 'Revert a committed assistant construction when no later revision exists' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async revertIntentConstruction(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Param('constructionId') constructionId: string,
  ) {
    return this.playbookFlowIntentConstructionService.revert(id, userId, constructionId);
  }
}
