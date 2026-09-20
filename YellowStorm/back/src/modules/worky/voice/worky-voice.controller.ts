import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../../authorization/constants/permissions';
import { GeminiTokenService, VoiceSessionEnvelope } from './gemini-token.service';
import { VoiceToolService } from './voice-tool.service';
import { requesterOpts } from '../worky-requester.util';
import { WorkyPlanningService } from '../services/worky-planning.service';
import { CONCIERGE_SYSTEM_PROMPT } from './voice-concierge.config';
import {
  CreateVoiceSessionDto,
  VoiceDispatchDto,
  VoiceListTasksDto,
  VoicePromptDto,
  VoiceStatusDto,
  VoiceStopDto,
  VoiceTaskDetailsDto,
  VoiceTranscriptDto,
} from './dto/voice.dto';

/**
 * BFF for the realtime voice concierge. Mints locked Gemini Live tokens and
 * executes the concierge's tool calls (dispatch / status) server-side so no
 * config or secrets ever reach the browser.
 */
@ApiTags('Worky')
@ApiBearerAuth()
@Controller('worky/voice')
export class WorkyVoiceController {
  constructor(
    private readonly tokens: GeminiTokenService,
    private readonly tools: VoiceToolService,
    private readonly planning: WorkyPlanningService,
  ) {}

  @Post('session')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Mint an ephemeral Gemini Live session token (per-stream persona)' })
  async createSession(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateVoiceSessionDto,
  ): Promise<VoiceSessionEnvelope> {
    const prompt = dto.streamId
      ? ((await this.planning.getVoicePrompt(user._id.toString(), dto.streamId)).prompt ?? undefined)
      : undefined;
    // Tell the concierge who it is speaking with (name + role) so it greets and
    // addresses them naturally. Same identity the orchestrator turn gets.
    const r = requesterOpts(user);
    return this.tokens.mintSessionToken({
      resumptionHandle: dto.resumptionHandle,
      prompt,
      requester: { name: r.userName, email: r.userEmail, role: r.userRole },
    });
  }

  @Get('prompt/:streamId')
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Get the per-stream concierge prompt (or the default)' })
  async getPrompt(@CurrentUser() user: AuthUser, @Param('streamId') streamId: string) {
    const { prompt } = await this.planning.getVoicePrompt(user._id.toString(), streamId);
    return { prompt: prompt ?? CONCIERGE_SYSTEM_PROMPT, isDefault: prompt == null };
  }

  @Put('prompt/:streamId')
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Set (or reset via blank) the per-stream concierge prompt' })
  async setPrompt(
    @CurrentUser() user: AuthUser,
    @Param('streamId') streamId: string,
    @Body() dto: VoicePromptDto,
  ) {
    const { prompt } = await this.planning.setVoicePrompt(user._id.toString(), streamId, dto.prompt);
    return { prompt: prompt ?? CONCIERGE_SYSTEM_PROMPT, isDefault: prompt == null };
  }

  @Post('tool/dispatch')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Voice tool: dispatch a worky task' })
  async dispatch(@CurrentUser() user: AuthUser, @Body() dto: VoiceDispatchDto) {
    return this.tools.dispatchTask(user._id.toString(), dto.streamId, dto.message);
  }

  @Post('tool/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Voice tool: query the current worky task status' })
  async status(@CurrentUser() user: AuthUser, @Body() dto: VoiceStatusDto) {
    return this.tools.queryStatus(user._id.toString(), dto.streamId);
  }

  @Post('tool/stop')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Voice tool: stop the whole worky run (StopSession RPC, terminal)' })
  async stop(@CurrentUser() user: AuthUser, @Body() dto: VoiceStopDto) {
    return this.tools.stopSession(user._id.toString(), dto.streamId);
  }

  @Post('tool/list-tasks')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Voice tool: list the stream tasks as compact summaries' })
  async listTasks(@CurrentUser() user: AuthUser, @Body() dto: VoiceListTasksDto) {
    return this.tools.listTasks(user._id.toString(), dto.streamId);
  }

  @Post('tool/task-details')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Voice tool: get full detail for one task' })
  async taskDetails(@CurrentUser() user: AuthUser, @Body() dto: VoiceTaskDetailsDto) {
    return this.tools.getTaskDetails(user._id.toString(), dto.streamId, dto.taskId);
  }

  @Post('tool/transcript')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Persist a voice transcript turn into chat history' })
  async transcript(@CurrentUser() user: AuthUser, @Body() dto: VoiceTranscriptDto) {
    return this.planning.appendVoiceMessage(user._id.toString(), dto.streamId, dto.role, dto.text);
  }
}
