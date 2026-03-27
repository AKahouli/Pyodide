import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PlaybookService } from '../services/playbook.service';
import { PlaybookExecutionService } from '../services/playbook-execution.service';
import { PlaybookDesignService } from '../services/playbook-design.service';
import { PlaybookReplayService } from '../services/playbook-replay.service';
import { PlaybookOutputFormatService } from '../services/playbook-output-format.service';
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
import { ValidateTaskReplayDto } from '../dto/validate-task-replay.dto';
import { UpdateTaskReplayFormatDto } from '../dto/update-task-replay-format.dto';
import { GrabOutputFormatTemplateDto } from '../dto/grab-output-format-template.dto';
import { UpdateOutputFormatTemplateDto } from '../dto/update-output-format-template.dto';
import { RerunStepDto } from '../dto/rerun-step.dto';
import { ResumeFromStepDto } from '../dto/resume-from-step.dto';

@ApiTags('Playbooks')
@Controller('playbooks')
@ApiBearerAuth()
export class PlaybookController {
  constructor(
    private readonly playbookService: PlaybookService,
    private readonly executionService: PlaybookExecutionService,
    private readonly designService: PlaybookDesignService,
    private readonly replayService: PlaybookReplayService,
    private readonly outputFormatService: PlaybookOutputFormatService,
    private readonly streamGateway: PlaybookStreamGatewayService,
    private readonly userService: UserService,
    private readonly notificationsService: NotificationsService,
  ) {}

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
    return this.executionService.executePlaybook(user._id.toString(), id, dto, user.email);
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
      user.email,
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
