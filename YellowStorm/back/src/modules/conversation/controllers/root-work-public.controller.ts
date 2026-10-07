import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ConversationOwnerGuard } from '../guards/conversation-owner.guard';
import { RootStopDto, RootWorkCursorDto } from '../dto/root-work-public.dto';
import { RootWorkPublicService } from '../root-work/root-work-public.service';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations/:id/root-work')
@UseGuards(ConversationOwnerGuard)
export class RootWorkPublicController {
  constructor(private readonly work: RootWorkPublicService) {}

  @Get()
  snapshot(@Param('id') id: string, @CurrentUser() user: { _id: string }) {
    return this.work.snapshot(id, user._id.toString());
  }

  @Get('events')
  replay(@Param('id') id: string, @CurrentUser() user: { _id: string }, @Query() cursor: RootWorkCursorDto) {
    return this.work.replay(id, user._id.toString(), cursor.epoch, cursor.after);
  }

  @Post('stop')
  stop(@Param('id') id: string, @CurrentUser() user: { _id: string }, @Body() request: RootStopDto) {
    return this.work.stop(id, user._id.toString(), request);
  }
}
