import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../../authorization/constants/permissions';
import { GeminiTokenService, VoiceSessionEnvelope } from './gemini-token.service';
import { VoiceToolService } from './voice-tool.service';
import { WorkyPlanningService } from '../services/worky-planning.service';
import { CreateVoiceSessionDto, VoiceDispatchDto, VoiceStatusDto, VoiceTranscriptDto } from './dto/voice.dto';

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
  @ApiOperation({ summary: 'Mint a locked ephemeral Gemini Live session token' })
  async createSession(
    @CurrentUser() _user: UserDocument,
    @Body() dto: CreateVoiceSessionDto,
  ): Promise<VoiceSessionEnvelope> {
    return this.tokens.mintSessionToken({ resumptionHandle: dto.resumptionHandle });
  }

  @Post('tool/dispatch')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Voice tool: dispatch a worky task' })
  async dispatch(@CurrentUser() user: UserDocument, @Body() dto: VoiceDispatchDto) {
    return this.tools.dispatchTask(user._id.toString(), dto.streamId, dto.message);
  }

  @Post('tool/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Voice tool: query the current worky task status' })
  async status(@CurrentUser() user: UserDocument, @Body() dto: VoiceStatusDto) {
    return this.tools.queryStatus(user._id.toString(), dto.streamId);
  }

  @Post('tool/transcript')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Persist a voice transcript turn into chat history' })
  async transcript(@CurrentUser() user: UserDocument, @Body() dto: VoiceTranscriptDto) {
    return this.planning.appendVoiceMessage(user._id.toString(), dto.streamId, dto.role, dto.text);
  }
}
