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
import { ModelsService } from '../../models/models.service';
import { ConnectorService } from '../../connector/connector.service';

@ApiTags('Worky')
@ApiBearerAuth()
@UseGuards(WorkyStreamAccessGuard)
@Controller('worky/streams')
export class WorkyMessageController {
  constructor(
    private readonly planning: WorkyPlanningService,
    private readonly streamService: WorkyStreamService,
    private readonly orchestrator: WorkyOrchestratorGrpcClientService,
    private readonly models: ModelsService,
    private readonly connectorService: ConnectorService,
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
    const { aiSessionId, managerModelId } = await this.streamService.ensureKickoffContext(
      streamId,
      user._id.toString(),
    );
    // Manager model + per-user connectors (shared with the resume path).
    const model = await this.resolveManagerModel(
      dto.managerModelId?.trim() || managerModelId || null,
    );
    const connectors = await this.resolveWorkyConnectors(user._id.toString());
    // Fire-and-forget kickoff. The manager writes task/message rows into
    // its Postgres; the Electric consumer mirrors them into Mongo and
    // re-emits over the SSE channel `/worky/streams/{id}/events`.
    this.logger.log('[worky-orchestrator] RunTask kickoff', {
      streamId,
      aiSid: aiSessionId,
      model,
      contentLength: dto.content?.length,
      idempotencyKey: saved.id,
      connectorCount: connectors.length,
    });
    void this.orchestrator
      .runTask(user._id.toString(), aiSessionId, dto.content, {
        model,
        idempotencyKey: saved.id,
        connectors,
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
  // which re-drives the remaining steps. Connectors/model are re-sent so the
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

    const model = await this.resolveManagerModel(stream.managerModelId ?? null);
    const connectors = await this.resolveWorkyConnectors(user._id.toString());
    void this.orchestrator
      .runTask(user._id.toString(), aiSessionId, '', {
        model,
        idempotencyKey: `resume-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        connectors,
      })
      .catch((err) =>
        this.logger.error('[worky-orchestrator] resume RunTask failed', {
          streamId,
          error: (err as Error).message,
        }),
      );
    return { resumed: true };
  }

  /** Manager model priority: given value → admin default. Returns undefined only
   *  if no model resolves (RunTask treats model as optional). */
  private async resolveManagerModel(preferred: string | null): Promise<string | undefined> {
    let model = preferred || null;
    if (!model) {
      model = this.models.getModelIdentifier(await this.models.getDefaultModel()) || null;
    }
    return model ?? undefined;
  }

  /** Per-user connectors worky needs (code-interpreter, linkup, microsoft365).
   *  Auth resolved by ConnectorService; failures are non-fatal (send none). */
  private async resolveWorkyConnectors(userId: string): Promise<unknown[]> {
    const WORKY_CONNECTOR_SLUGS = ['code-interpreter', 'linkup', 'microsoft365'];
    try {
      const found = (
        await Promise.all(WORKY_CONNECTOR_SLUGS.map((slug) => this.connectorService.findBySlug(slug)))
      ).filter(Boolean);
      if (found.length) {
        return await this.connectorService.findByIdsForGrpc(
          found.map((c) => c!.id),
          userId,
        );
      }
    } catch (err) {
      this.logger.warn('[worky-orchestrator] connector resolution failed; sending none', {
        error: (err as Error).message,
      });
    }
    return [];
  }
}
