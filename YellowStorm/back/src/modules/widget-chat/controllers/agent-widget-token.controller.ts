import { Controller, Get, Post, Patch, Delete, Body, Param } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { UserDocument } from '@modules/user/schemas/user.schema';
import { AgentService } from '@modules/agent/agent.service';
import { WidgetChatService } from '../services/widget-chat.service';
import { CreateWidgetTokenDto, UpdateWidgetTokenDto } from '../dto/widget-chat.dto';

@ApiTags('Agent Widget Tokens')
@Controller('agents/:agentId/widget-tokens')
@ApiBearerAuth()
export class AgentWidgetTokenController {
  constructor(
    private readonly widgetChatService: WidgetChatService,
    private readonly agentService: AgentService,
  ) {}

  @Post()
  async createToken(
    @Param('agentId') agentId: string,
    @Body() dto: CreateWidgetTokenDto,
    @CurrentUser() user: UserDocument,
  ) {
    await this.agentService.findUserAgentById(user._id.toString(), agentId);
    return this.widgetChatService.createToken(agentId, user._id.toString(), {
      label: dto.label,
      allowedOrigins: dto.allowedOrigins,
      expiresAt: dto.expiresAt,
    });
  }

  @Get()
  async listTokens(@Param('agentId') agentId: string, @CurrentUser() user: UserDocument) {
    await this.agentService.findUserAgentById(user._id.toString(), agentId);
    return this.widgetChatService.listTokens(agentId);
  }

  @Patch(':tokenId')
  async updateToken(
    @Param('agentId') agentId: string,
    @Param('tokenId') tokenId: string,
    @Body() dto: UpdateWidgetTokenDto,
    @CurrentUser() user: UserDocument,
  ) {
    await this.agentService.findUserAgentById(user._id.toString(), agentId);
    return this.widgetChatService.updateToken(agentId, tokenId, dto);
  }

  @Delete(':tokenId')
  async revokeToken(
    @Param('agentId') agentId: string,
    @Param('tokenId') tokenId: string,
    @CurrentUser() user: UserDocument,
  ) {
    await this.agentService.findUserAgentById(user._id.toString(), agentId);
    return this.widgetChatService.revokeToken(agentId, tokenId);
  }
}
