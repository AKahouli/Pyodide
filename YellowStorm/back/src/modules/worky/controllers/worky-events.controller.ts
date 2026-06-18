import {
  Controller,
  MessageEvent,
  Param,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Subject, firstValueFrom } from 'rxjs';
import { WorkyStreamAccessGuard } from '../guards/worky-stream-access.guard';
import { WorkyEventService } from '../services/worky-event.service';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';

@ApiTags('Worky')
@ApiBearerAuth()
@Controller('worky/streams')
export class WorkyEventsController {
  constructor(private readonly events: WorkyEventService) {}

  /**
   * Per-(user, stream) SSE channel. Mirrors the `conversation-v2` per-user
   * pipe + heartbeat pattern. Frames are tagged with their `type` (matches
   * the `WorkyEventType` union) and carry the full `WorkyEvent` in `data`.
   * TODO(Part 3): durable event replay — currently the channel is fire-and-
   * forget; missed events on reconnect are recovered via REST.
   */
  @Sse(':id/events')
  @UseGuards(WorkyStreamAccessGuard)
  @ApiOperation({ summary: 'SSE — live events for one Worky stream' })
  stream(
    @CurrentUser() user: UserDocument,
    @Param('id') streamId: string,
  ): Promise<MessageEvent> {
    const connectionId = `${user._id.toString()}:${streamId}:${Date.now()}`;
    const disconnect$ = new Subject<void>();
    const stream$ = this.events.registerConnection(
      user._id.toString(),
      streamId,
      connectionId,
      disconnect$,
    );
    if (!stream$) {
      return Promise.resolve({
        type: 'error',
        data: {
          code: 'WORKY_SSE_LIMIT',
          message: 'Too many open Worky SSE connections for this stream.',
        },
      } as MessageEvent);
    }
    return firstValueFrom(stream$);
  }
}
