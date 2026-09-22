import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { AgentPermissionGuard } from '@modules/agent/guards/agent-permission.guard';
import { RequireAgentPermission } from '@modules/agent/decorators/require-agent-permission.decorator';
import { WidgetChatService } from '../services/widget-chat.service';
import { CreateWidgetTokenDto, UpdateWidgetTokenDto } from '../dto/widget-chat.dto';

@ApiTags('Agent Widget Tokens')
@Controller('agents/:agentId/widget-tokens')
@ApiBearerAuth()
export class AgentWidgetTokenController {
  constructor(
    private readonly widgetChatService: WidgetChatService,
  ) {}

  @Post()
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('write')
  async createToken(
    @Param('agentId') agentId: string,
    @Body() dto: CreateWidgetTokenDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.widgetChatService.createToken(agentId, user._id.toString(), {
      label: dto.label,
      allowedOrigins: dto.allowedOrigins,
      expiresAt: dto.expiresAt,
    });
  }

  @Get()
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('read')
  async listTokens(@Param('agentId') agentId: string, @CurrentUser() user: AuthUser) {
    return this.widgetChatService.listTokens(agentId);
  }

  @Patch(':tokenId')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('write')
  async updateToken(
    @Param('agentId') agentId: string,
    @Param('tokenId') tokenId: string,
    @Body() dto: UpdateWidgetTokenDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.widgetChatService.updateToken(agentId, tokenId, dto);
  }

  @Delete(':tokenId')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('write')
  async revokeToken(
    @Param('agentId') agentId: string,
    @Param('tokenId') tokenId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.widgetChatService.revokeToken(agentId, tokenId);
  }
}
