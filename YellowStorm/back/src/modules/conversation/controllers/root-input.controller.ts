import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { ConversationOwnerGuard } from '../guards/conversation-owner.guard';
import { RootInputService } from '../root-work/root-input.service';
import { RootBackgroundInputService } from '../root-work/root-background-input.service';
import { RootBackgroundInputsDto } from '../dto/root-background.dto';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations/:id/root-inputs')
@UseGuards(ConversationOwnerGuard)
export class RootInputController {
  constructor(private readonly inputs: RootInputService, private readonly background: RootBackgroundInputService) {}

  @Post('background/:executionId')
  submitBackgroundInput(@Param('id') id: string, @Param('executionId') executionId: string,
    @CurrentUser() user: { _id: string }, @Body() request: RootBackgroundInputsDto) {
    return this.background.submit(id, executionId, user._id.toString(), request.inputResponses);
  }

  @Get()
  getPendingInputs(@Param('id') id: string, @CurrentUser() user: { _id: string }) {
    return this.inputs.getPendingInputs(id, user._id.toString());
  }
}
