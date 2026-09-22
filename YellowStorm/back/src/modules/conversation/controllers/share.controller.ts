import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ShareService } from '../services/share.service';
import { CreateShareDto } from '../dto/create-share.dto';
import { ConversationOwnerGuard } from '../guards/conversation-owner.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';

@ApiTags('Conversation Sharing')
@Controller('conversations')
@ApiBearerAuth()
export class ShareController {
  constructor(private readonly shareService: ShareService) {}

  @Post(':conversationId/share')
  @UseGuards(ConversationOwnerGuard)
  async createShare(
    @CurrentUser() user: { _id: string },
    @Param('conversationId') conversationId: string,
    @Body() dto: CreateShareDto,
  ) {
    return this.shareService.createShare(user._id.toString(), {
      conversationId,
      shareType: dto.shareType,
      title: dto.title,
      recipientEmails: dto.recipientEmails,
      shareWorkspaces: dto.shareWorkspaces,
      expiresInDays: dto.expiresInDays,
    });
  }

  @Get(':conversationId/shares')
  @UseGuards(ConversationOwnerGuard)
  async getShares(
    @CurrentUser() user: { _id: string },
    @Param('conversationId') conversationId: string,
  ) {
    return this.shareService.getSharesForConversation(conversationId, user._id.toString());
  }

  @Delete(':conversationId/share/:shareId')
  @UseGuards(ConversationOwnerGuard)
  async revokeShare(
    @CurrentUser() user: { _id: string },
    @Param('shareId') shareId: string,
  ) {
    await this.shareService.revokeShare(shareId, user._id.toString());
    return { revoked: true };
  }

  @Get('shared/:accessToken')
  async viewPublicShare(@Param('accessToken') accessToken: string) {
    return this.shareService.viewPublicShare(accessToken);
  }
}
