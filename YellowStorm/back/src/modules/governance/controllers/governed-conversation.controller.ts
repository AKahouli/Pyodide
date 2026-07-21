import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { ConversationResponse } from '@modules/conversation/interfaces/conversation.interface';
import { CreateGovernedConversationDto } from '../dto';
import { GovernedConversationService } from '../services/governed-conversation.service';

@ApiTags('Conversations')
@ApiBearerAuth()
@Controller('conversations')
export class GovernedConversationController {
  constructor(private readonly governedConversationService: GovernedConversationService) {}

  @Post('governed')
  @ApiOperation({ summary: 'Start a conversation pinned to an authorized published governance scope' })
  create(@CurrentUser() user: UserDocument, @Body() dto: CreateGovernedConversationDto): Promise<ConversationResponse> {
    return this.governedConversationService.create(user._id.toString(), dto);
  }

  @Get(':conversationId/runtime-capabilities')
  @ApiOperation({ summary: 'Get the controls and published resources available in a conversation' })
  capabilities(@CurrentUser() user: UserDocument, @Param('conversationId') conversationId: string): Promise<Record<string, unknown>> {
    return this.governedConversationService.getCapabilities(user._id.toString(), conversationId);
  }
}
