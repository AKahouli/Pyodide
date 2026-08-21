import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { WorkyStreamAccessGuard } from '../guards/worky-stream-access.guard';
import { WorkyPlanningService } from '../services/worky-planning.service';
import { WorkyStreamService } from '../services/worky-stream.service';
import { WorkyOrchestratorGrpcClientService } from '../services/worky-orchestrator.grpc-client.service';
import { CreateWorkyMessageDto } from '../dto/create-worky-message.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../../authorization/constants/permissions';
import { LoggerService } from '../../logger';
import { WorkyTurnContextService } from '../services/worky-turn-context.service';
import { requesterOpts } from '../worky-requester.util';

@ApiTags('Worky')
@ApiBearerAuth()
@UseGuards(WorkyStreamAccessGuard)
@Controller('worky/streams')
export class WorkyMessageController {
  constructor(
    private readonly planning: WorkyPlanningService,
    private readonly streamService: WorkyStreamService,
    private readonly orchestrator: WorkyOrchestratorGrpcClientService,
    private readonly turnContext: WorkyTurnContextService,
    private readonly logger: LoggerService,
  ) {
    this.logger.setContext(WorkyMessageController.name);
  }

  @Post(':id/messages')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Send an owner message; kicks off a planning turn' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async sendMessage(
    @CurrentUser() user: UserDocument,
    @Param('id') streamId: string,
    @Body() dto: CreateWorkyMessageDto,
  ): Promise<{ id: string; content: string; createdAt: string; turnStarted: true }> {
    const saved = await this.planning.appendOwnerMessage(user._id.toString(), streamId, dto);
    const ctx = await this.streamService.ensureKickoffContext(streamId, user._id.toString());
    // The two agents worky forwards (default worky-planner + worky-executer)
    // carry their own model/prompt/tools; connectors resolve separately. Shared
    // with the resume path.
    const [agents, connectors] = await Promise.all([
      this.turnContext.resolveWorkyAgents(user._id.toString()),
      this.turnContext.resolveConnectors(user._id.toString()),
    ]);
    // Fire-and-forget kickoff. The manager writes task/message rows into
    // its Postgres; the Electric consumer mirrors them into Mongo and
    // re-emits over the SSE channel `/worky/streams/{id}/events`.
    this.logger.log('[worky-orchestrator] RunTask kickoff', {
      streamId,
      aiSid: ctx.aiSessionId,
      agentCount: agents.length,
      contentLength: dto.content?.length,
      connectorCount: connectors.length,
    });
    void this.orchestrator
      .runTask(user._id.toString(), ctx.aiSessionId, dto.content, {
        agents,
        connectors,
        ...requesterOpts(user),
      })
      .catch((err) =>
        this.logger.error('[worky-orchestrator] RunTask kickoff failed', {
          streamId,
          error: (err as Error).message,
        }),
      );
    return { ...saved, turnStarted: true };
  }

  @Get(':id/messages')
  @RequirePermissions(Permissions.WORKY_STREAM_READ)
  @ApiOperation({ summary: 'List owner ↔ manager message history' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async listMessages(
    @CurrentUser() user: UserDocument,
    @Param('id') streamId: string,
    @Query('limit') limit?: string,
  ): Promise<
    Array<{
      id: string;
      role: string;
      content: string;
      planDeltaRef: string | null;
      createdAt: string;
      components: Array<{ id: string; type: string; data: Record<string, unknown> }>;
    }>
  > {
    const parsedLimit = limit ? Math.max(1, Math.min(500, Number(limit))) : undefined;
    return this.planning.listMessages(
      user._id.toString(),
      streamId,
      parsedLimit,
    );
  }

  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Stop the running orchestrator turn (StopSession RPC)' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async stop(
    @CurrentUser() user: UserDocument,
    @Param('id') streamId: string,
  ): Promise<{ stopped: boolean }> {
    const stream = await this.streamService.findByIdInternal(streamId);
    const aiSessionId = stream?.aiSessionId;
    if (!aiSessionId) return { stopped: false }; // no turn ever started
    return this.orchestrator.stopSession(user._id.toString(), aiSessionId);
  }

  // ':id/pause' is owned by the legacy stream controller (execution.pause), so
  // the orchestrator turn-pause lives at ':id/pause-turn'.
  @Post(':id/pause-turn')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Pause the running orchestrator turn (PauseSession RPC)' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async pauseTurn(
    @CurrentUser() user: UserDocument,
    @Param('id') streamId: string,
  ): Promise<{ paused: boolean }> {
    const stream = await this.streamService.findByIdInternal(streamId);
    const aiSessionId = stream?.aiSessionId;
    if (!aiSessionId) return { paused: false }; // no turn ever started
    return this.orchestrator.pauseSession(user._id.toString(), aiSessionId);
  }

  // Resume a paused orchestrator session. Per design, continue is always a
  // RunTask — an empty message on a paused session routes to continue_turn,
  // which re-drives the remaining steps. Connectors/agents are re-sent so the
  // pending steps still have their tools.
  @Post(':id/resume-turn')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions(Permissions.WORKY_STREAM_WRITE)
  @ApiOperation({ summary: 'Resume a paused orchestrator turn (continue via RunTask)' })
  @ApiParam({ name: 'id', description: 'Stream id' })
  async resumeTurn(
    @CurrentUser() user: UserDocument,
    @Param('id') streamId: string,
  ): Promise<{ resumed: boolean }> {
    const stream = await this.streamService.findByIdInternal(streamId);
    const aiSessionId = stream?.aiSessionId;
    if (!aiSessionId) return { resumed: false }; // nothing to resume

    const [agents, connectors] = await Promise.all([
      this.turnContext.resolveWorkyAgents(user._id.toString()),
      this.turnContext.resolveConnectors(user._id.toString()),
    ]);
    void this.orchestrator
      .runTask(user._id.toString(), aiSessionId, '', {
        agents,
        connectors,
        ...requesterOpts(user),
      })
      .catch((err) =>
        this.logger.error('[worky-orchestrator] resume RunTask failed', {
          streamId,
          error: (err as Error).message,
        }),
      );
    return { resumed: true };
  }
}
