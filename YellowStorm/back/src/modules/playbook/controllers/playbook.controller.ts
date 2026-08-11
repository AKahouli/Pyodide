import {
  Controller,
  Post,
  Get,
  Put,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Res,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { Public } from '../../auth/decorators/public.decorator';
import { PlaybookService } from '../services/playbook.service';
import { PlaybookExecutionService } from '../services/playbook-execution.service';
import { PlaybookDesignService } from '../services/playbook-design.service';
import { PlaybookJudgeEnrichmentService } from '../services/playbook-judge-enrichment.service';
import { PlaybookReplayService } from '../services/playbook-replay.service';
import { PlaybookOutputFormatService } from '../services/playbook-output-format.service';
import { PlaybookEvaluationService } from '../services/playbook-evaluation.service';
import { PlaybookStreamGatewayService } from '../services/playbook-stream-gateway.service';
import { PlaybookOwnerGuard } from '../guards/playbook-owner.guard';
import { UserService } from '../../user/user.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationType } from '../../notifications/schemas/notification.schema';
import { CheckUsage } from '../../usage/decorators/check-usage.decorator';
import { UsageLimitGuard } from '../../usage/guards/usage-limit.guard';
import { CreatePlaybookDto } from '../dto/create-playbook.dto';
import { GeneratePlaybookDto } from '../dto/generate-playbook.dto';
import { DesignPlaybookDto } from '../dto/design-playbook.dto';
import { UpdatePlaybookDto } from '../dto/update-playbook.dto';
import { PlaybookQueryDto } from '../dto/playbook-query.dto';
import { ExecutePlaybookDto } from '../dto/execute-playbook.dto';
import { ResumePlaybookDto } from '../dto/resume-playbook.dto';
import { StopPlaybookDto } from '../dto/stop-playbook.dto';
import { SkipPlaybookStepDto } from '../dto/skip-playbook-step.dto';
import { CloneSharePlaybookDto } from '../dto/clone-share-playbook.dto';
import { BulkDeletePlaybooksDto } from '../dto/bulk-delete-playbooks.dto';
import { UpsertPlaybookScheduleDto } from '../dto/upsert-playbook-schedule.dto';
import { UpsertPlaybookMailTriggerDto } from '../dto/upsert-playbook-mail-trigger.dto';
import { TestPlaybookMailEventDto } from '../dto/test-playbook-mail-event.dto';
import { SyncPlaybookMailSubscriptionDto } from '../dto/sync-playbook-mail-subscription.dto';
import { ValidateTaskReplayDto } from '../dto/validate-task-replay.dto';
import { UpdateTaskReplayFormatDto } from '../dto/update-task-replay-format.dto';
import { UpdateTaskReplayLabelDto } from '../dto/update-task-replay-label.dto';
import { GrabOutputFormatTemplateDto } from '../dto/grab-output-format-template.dto';
import { UpdateOutputFormatTemplateDto } from '../dto/update-output-format-template.dto';
import { RerunStepDto } from '../dto/rerun-step.dto';
import { GetAdvisorRemediationsDto, ApplyAdvisorRemediationsDto } from '../dto/advisor-remediation.dto';
import { ReapplyOptimizationDto } from '../dto/reapply-optimization.dto';
import { ResumeFromStepDto } from '../dto/resume-from-step.dto';
import { RewritePromptDto } from '../dto/rewrite-prompt.dto';
import {
  CreateEvaluationBaselineFromCurrentExecutionDto,
  CreateEvaluationBaselineFromExecutionDto,
} from '../dto/evaluation-baseline.dto';
import type { Response } from 'express';
import { SkipResponseWrap } from '../../response/decorators/skip-response-wrap.decorator';
import { PlaybookIntegrationLinkResponse } from '../interfaces/playbook.interface';
import { PlaybookMailTriggerTestEventService } from '../services/playbook-mail-trigger-test-event.service';
import { PlaybookMailGraphClientService } from '../services/playbook-mail-graph-client.service';
import { PlaybookRepeatabilityService } from '../services/playbook-repeatability.service';

@ApiTags('Playbooks')
@Controller('playbooks')
@ApiBearerAuth()
export class PlaybookController {
  constructor(
    private readonly playbookService: PlaybookService,
    private readonly executionService: PlaybookExecutionService,
    private readonly designService: PlaybookDesignService,
    private readonly judgeService: PlaybookJudgeEnrichmentService,
    private readonly replayService: PlaybookReplayService,
    private readonly outputFormatService: PlaybookOutputFormatService,
    private readonly evaluationService: PlaybookEvaluationService,
    private readonly repeatabilityService: PlaybookRepeatabilityService,
    private readonly mailTriggerTestEventService: PlaybookMailTriggerTestEventService,
    private readonly mailGraphClientService: PlaybookMailGraphClientService,
    private readonly streamGateway: PlaybookStreamGatewayService,
    private readonly userService: UserService,
    private readonly notificationsService: NotificationsService,
  ) {}

  @Get(':id/evaluations')
  @UseGuards(PlaybookOwnerGuard)
  async listEvaluationExecutions(@Param('id') id: string, @Query('taskId') taskId?: string) {
    return this.evaluationService.listEvaluationExecutions(id, taskId);
  }

  @Get(':id/evaluation-tasks/:taskId/baseline')
  @UseGuards(PlaybookOwnerGuard)
  async getEvaluationBaseline(@Param('id') id: string, @Param('taskId') taskId: string) {
    return this.evaluationService.getActiveBaseline(id, taskId);
  }

  @Post(':id/evaluation-tasks/:taskId/baseline/from-execution')
  @UseGuards(PlaybookOwnerGuard)
  async createEvaluationBaselineFromExecution(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() dto: CreateEvaluationBaselineFromExecutionDto,
  ) {
    return this.evaluationService.replaceBaselineFromExecution(id, taskId, dto.executionId, user._id.toString());
  }

  @Post(':id/evaluation-tasks/:taskId/baseline/from-current-execution')
  @UseGuards(PlaybookOwnerGuard)
  async createEvaluationBaselineFromCurrentExecution(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() dto: CreateEvaluationBaselineFromCurrentExecutionDto,
  ) {
    return this.evaluationService.replaceBaselineFromCurrentEvaluationExecution(
      id,
      taskId,
      dto.executionId,
      dto.evaluationExecutionId,
      user._id.toString(),
    );
  }

  @Delete(':id/evaluation-tasks/:taskId/baseline')
  @UseGuards(PlaybookOwnerGuard)
  async removeEvaluationBaseline(@Param('id') id: string, @Param('taskId') taskId: string) {
    return this.evaluationService.removeActiveBaseline(id, taskId);
  }

  @Get(':id/repeatability')
  @UseGuards(PlaybookOwnerGuard)
  @ApiOperation({ summary: 'Get playbook repeatability analysis' })
  async getRepeatability(
    @Param('id') id: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const parsedLimit = Math.min(Math.max(parseInt(limit || '5', 10) || 5, 1), 20);
    const parsedOffset = Math.max(parseInt(offset || '0', 10) || 0, 0);
    return this.repeatabilityService.getRepeatability(id, parsedLimit, parsedOffset);
  }

  @Get(':id/repeatability/:taskId')
  @UseGuards(PlaybookOwnerGuard)
  @ApiOperation({ summary: 'Get task-level repeatability analysis' })
  async getTaskRepeatability(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Query('limit') limit?: string,
  ) {
    const parsedLimit = Math.min(Math.max(parseInt(limit || '5', 10) || 5, 1), 20);
    return this.repeatabilityService.getTaskRepeatability(id, taskId, parsedLimit);
  }

  @Post()
  async create(
    @CurrentUser() user: { _id: string },
    @Body() dto: CreatePlaybookDto,
  ) {
    return this.playbookService.create(user._id.toString(), dto);
  }

  @Get()
  async findAll(
    @CurrentUser() user: { _id: string },
    @Query() query: PlaybookQueryDto,
  ) {
    return this.playbookService.findAllByUser(user._id.toString(), query);
  }

  @Post('generate')
  @UseGuards(UsageLimitGuard)
  @CheckUsage()
  async generate(
    @CurrentUser() user: { _id: string; email: string },
    @Body() dto: GeneratePlaybookDto,
  ) {
    return this.designService.generatePlaybook(user._id.toString(), dto, user.email);
  }

  @Post('rewrite-prompt')
  @UseGuards(UsageLimitGuard)
  @CheckUsage()
  @SkipResponseWrap()
  async rewritePrompt(
    @CurrentUser() user: { _id: string; email: string },
    @Body() dto: RewritePromptDto,
    @Res() res: Response,
  ) {
    res.status(200);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    let fullText = '';

    try {
      const result = await this.designService.rewritePromptStream(
        user._id.toString(),
        dto.prompt,
        (chunk) => {
          fullText += chunk;
          res.write(chunk);
          res.flush?.();
        },
      );

      res.end();
      return;
    } catch (error) {
      if (!res.headersSent) {
        res.status(503);
      }
      res.end();
      return;
    }
  }

  @Post('bulk-delete')
  async bulkDelete(
    @CurrentUser() user: { _id: string },
    @Body() dto: BulkDeletePlaybooksDto,
  ) {
    return this.playbookService.bulkDelete(user._id.toString(), dto.ids);
  }

  @Get('active-executions')
  async getActiveExecutions(
    @CurrentUser() user: { _id: string },
  ) {
    return this.executionService.findActiveExecutionsByUser(user._id.toString());
  }

  @Get(':id/schedule')
  @UseGuards(PlaybookOwnerGuard)
  @ApiOperation({ summary: 'Get embedded execution schedule for a playbook (owner only)' })
  @ApiParam({ name: 'id', description: 'Playbook id' })
  @ApiResponse({ status: 200, description: 'Current schedule payload or null when unset' })
  async getSchedule(@Param('id') id: string) {
    return this.playbookService.getSchedule(id);
  }

  @Get(':id/triggers')
  @UseGuards(PlaybookOwnerGuard)
  @ApiOperation({ summary: 'Get playbook triggers (owner only)' })
  @ApiParam({ name: 'id', description: 'Playbook id' })
  @ApiResponse({ status: 200, description: 'Derived trigger model for the playbook' })
  async getTriggers(@Param('id') id: string) {
    return this.playbookService.getTriggers(id);
  }

  @Put(':id/schedule')
  @UseGuards(PlaybookOwnerGuard)
  @ApiOperation({ summary: 'Create or replace execution schedule (owner only)' })
  @ApiParam({ name: 'id', description: 'Playbook id' })
  @ApiResponse({ status: 200, description: 'Playbook with updated executionSchedule' })
  async upsertSchedule(@Param('id') id: string, @Body() dto: UpsertPlaybookScheduleDto) {
    return this.playbookService.upsertSchedule(id, dto);
  }

  @Put(':id/triggers/schedule')
  @UseGuards(PlaybookOwnerGuard)
  @ApiOperation({ summary: 'Create or replace the schedule automated trigger (owner only)' })
  @ApiParam({ name: 'id', description: 'Playbook id' })
  @ApiResponse({ status: 200, description: 'Playbook with updated schedule trigger' })
  async upsertScheduleTrigger(@Param('id') id: string, @Body() dto: UpsertPlaybookScheduleDto) {
    return this.playbookService.upsertSchedule(id, dto);
  }

  @Delete(':id/schedule')
  @UseGuards(PlaybookOwnerGuard)
  @ApiOperation({ summary: 'Remove execution schedule from playbook (owner only)' })
  @ApiParam({ name: 'id', description: 'Playbook id' })
  @ApiResponse({ status: 200, description: 'Playbook with executionSchedule cleared' })
  async clearSchedule(@Param('id') id: string) {
    return this.playbookService.clearSchedule(id);
  }

  @Delete(':id/triggers/schedule')
  @UseGuards(PlaybookOwnerGuard)
  @ApiOperation({ summary: 'Disable the schedule automated trigger (owner only)' })
  @ApiParam({ name: 'id', description: 'Playbook id' })
  @ApiResponse({ status: 200, description: 'Playbook with schedule trigger disabled' })
  async clearScheduleTrigger(@Param('id') id: string) {
    return this.playbookService.clearSchedule(id);
  }

  @Put(':id/triggers/mail')
  @UseGuards(PlaybookOwnerGuard)
  @ApiOperation({ summary: 'Create or replace the mail automated trigger config (owner only)' })
  @ApiParam({ name: 'id', description: 'Playbook id' })
  @ApiResponse({ status: 200, description: 'Playbook with updated mail trigger config' })
  async upsertMailTrigger(@Param('id') id: string, @Body() dto: UpsertPlaybookMailTriggerDto) {
    return this.playbookService.upsertMailTrigger(id, dto);
  }

  @Delete(':id/triggers/mail')
  @UseGuards(PlaybookOwnerGuard)
  @ApiOperation({ summary: 'Disable the mail automated trigger config (owner only)' })
  @ApiParam({ name: 'id', description: 'Playbook id' })
  @ApiResponse({ status: 200, description: 'Playbook with mail trigger disabled' })
  async clearMailTrigger(@Param('id') id: string) {
    return this.playbookService.clearMailTrigger(id);
  }

  @Post(':id/triggers/mail/test-event')
  @UseGuards(PlaybookOwnerGuard)
  @ApiOperation({ summary: 'Inject a synthetic mail event into the playbook trigger pipeline (owner only)' })
  @ApiParam({ name: 'id', description: 'Playbook id' })
  @ApiResponse({ status: 200, description: 'Mail trigger evaluation and optional execution handoff result' })
  async testMailTriggerEvent(
    @CurrentUser() user: { _id: string; email: string },
    @Param('id') id: string,
    @Body() dto: TestPlaybookMailEventDto,
  ) {
    return this.mailTriggerTestEventService.processTestEvent(
      id,
      user._id.toString(),
      user.email,
      dto,
    );
  }

  @Post(':id/triggers/mail/sync-subscription')
  @UseGuards(PlaybookOwnerGuard)
  @ApiOperation({ summary: 'Create a Microsoft Graph mailbox subscription for this playbook trigger (owner only)' })
  async syncMailSubscription(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
    @Body() dto: SyncPlaybookMailSubscriptionDto,
  ) {
    const playbook = await this.playbookService.findById(id);
    const mailTrigger = playbook.triggers.find((trigger) => trigger.type === 'mail');
    const mailboxAppKey = mailTrigger?.config?.mailboxAppKey || 'microsoft';

    const effectiveCutoff = dto.autoRenewUntil ?? mailTrigger?.config?.autoRenewUntil ?? null;
    if (effectiveCutoff && new Date(effectiveCutoff).getTime() <= Date.now()) {
      throw new BadRequestException('autoRenewUntil must be in the future');
    }

    const subscription = await this.mailGraphClientService.createInboxSubscription(
      user._id.toString(),
      mailboxAppKey,
      dto.notificationUrl || 'http://localhost:3000/api/v1/playbooks/mail/webhook',
      `ys_${id}`,
      effectiveCutoff,
    );

    await this.playbookService.syncMailTriggerSubscription(id, {
      mailboxAppKey,
      notificationUrl: dto.notificationUrl || 'http://localhost:3000/api/v1/playbooks/mail/webhook',
      autoRenewUntil: dto.autoRenewUntil ?? mailTrigger?.config?.autoRenewUntil ?? null,
      subscriptionId: subscription.id || null,
      subscriptionClientState: `ys_${id}`,
      subscriptionExpiresAt: subscription.expirationDateTime || null,
    });

    return subscription;
  }

  @Get(':id')
  @UseGuards(PlaybookOwnerGuard)
  async findOne(@Param('id') id: string) {
    return this.playbookService.findById(id);
  }

  @Patch(':id')
  @UseGuards(PlaybookOwnerGuard)
  async update(@Param('id') id: string, @Body() dto: UpdatePlaybookDto) {
    return this.playbookService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(PlaybookOwnerGuard)
  async delete(@Param('id') id: string) {
    await this.playbookService.delete(id);
    return { deleted: true };
  }

  @Post(':id/favorite')
  @UseGuards(PlaybookOwnerGuard)
  async toggleFavorite(@Param('id') id: string) {
    return this.playbookService.toggleFavorite(id);
  }

  @Post(':id/design')
  @UseGuards(PlaybookOwnerGuard, UsageLimitGuard)
  @CheckUsage()
  async design(
    @CurrentUser() user: { _id: string; email: string },
    @Param('id') id: string,
    @Body() dto: DesignPlaybookDto,
  ) {
    return this.designService.designPlaybook(user._id.toString(), id, dto, user.email);
  }

  @Post(':id/judge/update-current')
  @UseGuards(PlaybookOwnerGuard, UsageLimitGuard)
  @CheckUsage()
  async updateFromJudge(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
    @Body() body: { executionId: string },
  ) {
    return this.judgeService.applyCurrentPlaybook(user._id.toString(), id, body.executionId);
  }

  @Post(':id/judge/generate-new')
  @UseGuards(PlaybookOwnerGuard, UsageLimitGuard)
  @CheckUsage()
  async generateFromJudge(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
    @Body() body: { executionId: string },
  ) {
    return this.judgeService.generateNewPlaybook(user._id.toString(), id, body.executionId);
  }

  @Post(':id/judge/optimize-step')
  @UseGuards(PlaybookOwnerGuard, UsageLimitGuard)
  @CheckUsage()
  async optimizeStepFromJudge(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
    @Body() body: { executionId: string; taskId: string },
  ) {
    return this.judgeService.optimizeStep(user._id.toString(), id, body.executionId, body.taskId);
  }

  @Get(':id/executions/:executionId/advisor-remediations')
  @UseGuards(PlaybookOwnerGuard)
  async getAdvisorRemediations(
    @Param('id') id: string,
    @Param('executionId') executionId: string,
    @Query() dto: GetAdvisorRemediationsDto,
  ) {
    return this.judgeService.getRemediations(executionId, dto.taskId);
  }

  @Post(':id/executions/:executionId/advisor-remediations/apply')
  @UseGuards(PlaybookOwnerGuard, UsageLimitGuard)
  @CheckUsage()
  async applyAdvisorRemediations(
    @CurrentUser() user: { _id: string; email: string },
    @Param('id') id: string,
    @Param('executionId') executionId: string,
    @Body() dto: ApplyAdvisorRemediationsDto,
  ) {
    return this.judgeService.applyRemediations(
      user._id.toString(),
      id,
      executionId,
      dto.selectedIds || [],
      dto.mode === 'generate-new' ? 'generate-new' : 'update-current',
    );
  }

  @Post(':id/executions/:executionId/tasks/:taskId/reapply-optimization')
  @UseGuards(PlaybookOwnerGuard)
  async reapplyOptimization(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
    @Param('executionId') executionId: string,
    @Param('taskId') taskId: string,
    @Body() body: ReapplyOptimizationDto,
  ) {
    return this.judgeService.reapplyOptimization(
      user._id.toString(),
      id,
      executionId,
      taskId,
      body.historyIndex,
      body.direction,
    );
  }

  @Get(':id/design-messages')
  @UseGuards(PlaybookOwnerGuard)
  async getDesignMessages(@Param('id') id: string) {
    return this.playbookService.getDesignMessages(id);
  }

  @Post(':id/design-messages/:msgId/revert')
  @UseGuards(PlaybookOwnerGuard)
  async revertToSnapshot(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
    @Param('msgId') msgId: string,
  ) {
    return this.playbookService.revertToSnapshot(id, msgId, user._id.toString());
  }

  @Post(':id/execute')
  @UseGuards(PlaybookOwnerGuard, UsageLimitGuard)
  @CheckUsage()
  async execute(
    @CurrentUser() user: { _id: string; email: string },
    @Param('id') id: string,
    @Body() dto: ExecutePlaybookDto,
  ) {
    return this.executionService.executePlaybook(user._id.toString(), id, dto, user.email, {
      executionTrigger: 'manual',
      userLanguage: (user as any).appearance?.language || 'en',
    });
  }

  @Post(':id/integration-link')
  @UseGuards(PlaybookOwnerGuard)
  async getIntegrationLink(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
  ): Promise<PlaybookIntegrationLinkResponse> {
    return this.playbookService.getOrCreateIntegrationToken(id, user._id.toString());
  }

  @Post('public/:token/execute')
  @Public()
  async executePublic(
    @Param('token') token: string,
    @Body() dto: ExecutePlaybookDto,
  ) {
    return this.executionService.executePlaybookByIntegrationToken(token, dto);
  }

  @Post(':id/tasks/:taskId/validate-replay')
  @UseGuards(PlaybookOwnerGuard)
  async validateTaskReplay(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() dto: ValidateTaskReplayDto,
  ) {
    return this.replayService.validateTaskReplay(
      user._id.toString(),
      id,
      taskId,
      dto.executionId,
      dto.preserveOutputFormat || false,
    );
  }

  @Get(':id/tasks/:taskId/replays')
  @UseGuards(PlaybookOwnerGuard)
  async listTaskReplays(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
  ) {
    return this.replayService.listTaskReplays(id, taskId);
  }

  @Post(':id/tasks/:taskId/replays/:replayId/activate')
  @UseGuards(PlaybookOwnerGuard)
  async activateTaskReplay(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Param('replayId') replayId: string,
  ) {
    return this.replayService.activateTaskReplay(id, taskId, replayId);
  }

  @Patch(':id/tasks/:taskId/replays/:replayId/format-guide')
  @UseGuards(PlaybookOwnerGuard)
  async updateTaskReplayFormatGuide(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Param('replayId') replayId: string,
    @Body() dto: UpdateTaskReplayFormatDto,
  ) {
    return this.replayService.updateTaskReplayFormatGuide(id, taskId, replayId, dto);
  }

  @Patch(':id/tasks/:taskId/replays/:replayId')
  @UseGuards(PlaybookOwnerGuard)
  async updateTaskReplayLabel(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Param('replayId') replayId: string,
    @Body() dto: UpdateTaskReplayLabelDto,
  ) {
    return this.replayService.updateTaskReplayLabel(id, taskId, replayId, dto.label);
  }

  @Delete(':id/tasks/:taskId/replays/:replayId')
  @UseGuards(PlaybookOwnerGuard)
  async deleteTaskReplay(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Param('replayId') replayId: string,
  ) {
    return this.replayService.deleteTaskReplay(id, taskId, replayId);
  }

  @Post(':id/tasks/:taskId/output-format-template')
  @UseGuards(PlaybookOwnerGuard)
  async grabOutputFormatTemplate(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() dto: GrabOutputFormatTemplateDto,
  ) {
    return this.outputFormatService.captureFromExecution(
      user._id.toString(),
      id,
      taskId,
      dto.executionId,
    );
  }

  @Get(':id/tasks/:taskId/output-format-template')
  @UseGuards(PlaybookOwnerGuard)
  async getActiveOutputFormatTemplate(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
  ) {
    return this.outputFormatService.getActiveTemplate(id, taskId);
  }

  @Patch(':id/tasks/:taskId/output-format-template')
  @UseGuards(PlaybookOwnerGuard)
  async updateActiveOutputFormatTemplate(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
    @Body() dto: UpdateOutputFormatTemplateDto,
  ) {
    return this.outputFormatService.updateActiveTemplate(id, taskId, dto);
  }

  @Delete(':id/tasks/:taskId/output-format-template')
  @UseGuards(PlaybookOwnerGuard)
  async removeActiveOutputFormatTemplate(
    @Param('id') id: string,
    @Param('taskId') taskId: string,
  ) {
    return this.outputFormatService.removeActiveTemplate(id, taskId);
  }

  @Post(':id/stop')
  @UseGuards(PlaybookOwnerGuard)
  async stop(
    @CurrentUser() user: { _id: string; email: string },
    @Param('id') id: string,
    @Body() dto: StopPlaybookDto,
  ) {
    return this.executionService.stopExecution(user._id.toString(), id, dto.executionId, user.email);
  }

  @Post(':id/skip-step')
  @UseGuards(PlaybookOwnerGuard)
  async skipStep(
    @CurrentUser() user: { _id: string; email: string },
    @Param('id') id: string,
    @Body() dto: SkipPlaybookStepDto,
  ) {
    return this.executionService.skipStep(user._id.toString(), id, dto.executionId, dto.taskId, user.email);
  }

  @Post(':id/resume')
  @UseGuards(PlaybookOwnerGuard, UsageLimitGuard)
  @CheckUsage()
  async resume(
    @CurrentUser() user: { _id: string; email: string },
    @Param('id') id: string,
    @Body() dto: ResumePlaybookDto,
  ) {
    return this.executionService.resumeExecution(user._id.toString(), id, dto, user.email);
  }

  @Post(':id/executions/:executionId/rerun-step')
  @UseGuards(PlaybookOwnerGuard)
  async rerunStep(
    @CurrentUser() user: { _id: string; email: string },
    @Param('id') id: string,
    @Param('executionId') executionId: string,
    @Body() dto: RerunStepDto,
  ) {
    return this.executionService.rerunStepInExecution(
      user._id.toString(),
      id,
      executionId,
      dto.taskId,
      dto.runEvaluation === true,
      dto.executionMode,
      dto.streaming === true,
      dto.runNodeReflection,
      user.email,
      dto.advisorAutopilotEnabled === true,
      dto.advisorAutopilotTargetScore,
      dto.advisorAutopilotMaxTurns,
      dto.skipStepExecution === true,
    );
  }

  @Post(':id/executions/:executionId/resume-from-step')
  @UseGuards(PlaybookOwnerGuard)
  async resumeFromStep(
    @CurrentUser() user: { _id: string; email: string },
    @Param('id') id: string,
    @Param('executionId') executionId: string,
    @Body() dto: ResumeFromStepDto,
  ) {
    return this.executionService.resumeFromStep(
      user._id.toString(),
      id,
      executionId,
      dto.taskId,
      dto.streaming === true,
      user.email,
    );
  }

  @Post(':id/clone')
  @UseGuards(PlaybookOwnerGuard)
  async clone(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
  ) {
    return this.playbookService.cloneForUser(id, user._id.toString(), { nameSuffix: ' (copy)' });
  }

  @Post(':id/clone-share')
  @UseGuards(PlaybookOwnerGuard)
  async cloneShare(
    @CurrentUser() user: { _id: string },
    @Param('id') id: string,
    @Body() dto: CloneSharePlaybookDto,
  ): Promise<{ succeeded: { email: string; playbookId: string }[]; failed: { email: string; reason: string }[] }> {
    const currentUserId = user._id.toString();
    const currentUser = await this.userService.findById(currentUserId);
    const currentEmail = currentUser?.email?.toLowerCase() || '';
    const senderName = currentUser?.profile?.firstName || 'Someone';

    const uniqueEmails = [...new Set(dto.emails.map((e) => e.toLowerCase()))].filter(
      (e) => e !== currentEmail,
    );

    const succeeded: { email: string; playbookId: string }[] = [];
    const failed: { email: string; reason: string }[] = [];

    for (const email of uniqueEmails) {
      const targetUser = await this.userService.findByEmail(email);
      if (!targetUser) {
        failed.push({ email, reason: 'User not found' });
        continue;
      }

      try {
        const cloned = await this.playbookService.cloneForUser(id, targetUser._id.toString());
        succeeded.push({ email, playbookId: cloned.id });

        this.notificationsService.sendToUser(targetUser._id.toString(), {
          type: NotificationType.INFO,
          title: 'Playbook shared with you',
          message: `${senderName} shared a playbook with you`,
          data: { playbookId: cloned.id },
          metadata: { sourceModule: 'playbook' },
        }).catch(() => {/* best-effort */});

        // SSE event so recipient's playbook list refreshes
        this.streamGateway.sendToUser(targetUser._id.toString(), {
          type: 'playbook_shared',
          data: { playbookId: cloned.id },
        });
      } catch {
        failed.push({ email, reason: 'Failed to clone playbook' });
      }
    }

    return { succeeded, failed };
  }
}
