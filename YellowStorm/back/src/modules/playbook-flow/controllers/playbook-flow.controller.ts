import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards, Logger, Inject } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ConfigType } from '@nestjs/config';
import { PlaybookFlowService } from '../services/playbook-flow.service';
import { PlaybookFlowDesignService } from '../services/playbook-flow-design.service';
import { PlaybookFlowDesignOperationService } from '../services/playbook-flow-design-operation.service';
import { PlaybookFlowEvaluationService } from '../services/playbook-flow-evaluation.service';
import { PlaybookFlowIntentService } from '../services/playbook-flow-intent.service';
import { CreatePlaybookFlowDto } from '../dto/create-playbook-flow.dto';
import { PatchPlaybookFlowDeltaDto } from '../dto/patch-playbook-flow-delta.dto';
import { UpdatePlaybookFlowDto } from '../dto/update-playbook-flow.dto';
import { PlaybookFlowQueryDto } from '../dto/playbook-flow-query.dto';
import { RequestPlaybookFlowIntentDto } from '../dto/request-playbook-flow-intent.dto';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { Permissions } from '@modules/authorization/constants/permissions';
import playbookFlowConfig from '@config/playbook-flow.config';
import { BadRequestException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

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
    @Inject(playbookFlowConfig.KEY)
    private readonly playbookFlowSettings: ConfigType<typeof playbookFlowConfig>,
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
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async findAll(
    @CurrentUser('_id') userId: string,
    @Query() query: PlaybookFlowQueryDto,
  ) {
    return this.playbookFlowService.findAll(userId, query);
  }

  @Get('active-executions')
  @ApiOperation({ summary: 'List active executions across playbooks' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async getActiveExecutions(
    @CurrentUser('_id') userId: string,
  ) {
    return this.playbookFlowService.getActiveExecutions(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a playbook flow by id' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
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
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
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
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async patchDelta(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Body() dto: PatchPlaybookFlowDeltaDto,
  ) {
    if (!this.playbookFlowSettings.deltaPatchEnabled) {
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
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async listEvaluations(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Query('taskId') taskId?: string,
  ) {
    return this.evaluationService.listEvaluationExecutions(flowId, taskId);
  }

  @Get(':id/evaluation-tasks/:taskId/baseline')
  @ApiOperation({ summary: 'Get active evaluation baseline for a task' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async getBaseline(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Query('iteration') iteration?: number,
  ) {
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
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async getDesignMessages(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
  ) {
    return this.designService.getDesignMessages(id, userId);
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

  @Post(':id/intent')
  @ApiOperation({ summary: 'Analyze a canvas-level playbook intent without mutating the flow' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async analyzeIntent(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Body() dto: RequestPlaybookFlowIntentDto,
  ) {
    return this.playbookFlowIntentService.analyze(id, userId, dto);
  }
}
