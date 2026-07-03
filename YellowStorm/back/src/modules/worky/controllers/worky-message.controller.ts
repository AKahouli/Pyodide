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
import { ConversationV2GrpcClientService } from '../../conversation-v2/services/conversation-v2.grpc-client.service';
import { CreateWorkyMessageDto } from '../dto/create-worky-message.dto';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { Permissions } from '../../authorization/constants/permissions';
import { LoggerService } from '../../logger';

@ApiTags('Worky')
@ApiBearerAuth()
@UseGuards(WorkyStreamAccessGuard)
@Controller('worky/streams')
export class WorkyMessageController {
  constructor(
    private readonly planning: WorkyPlanningService,
    private readonly streamService: WorkyStreamService,
    private readonly grpcClient: ConversationV2GrpcClientService,
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
    const aiSessionId = await this.streamService.getAiSessionId(streamId);
    // Fire-and-forget kickoff. The manager writes task/message rows into
    // its Postgres; the Electric consumer mirrors them into Mongo and
    // re-emits over the SSE channel `/worky/streams/{id}/events`.
    void this.grpcClient
      .worky(user._id.toString(), aiSessionId, dto.content, {})
      .catch((err) => this.logger.error('Worky gRPC kickoff failed', { streamId, error: (err as Error).message }));
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
}
