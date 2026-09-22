import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { Request } from 'express';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermissions, PermissionsGuard } from '@modules/authorization';
import type { AuthUser } from '@common/auth/auth-user';
import { WidgetChatService } from '../services/widget-chat.service';
import { CreateWidgetTokenDto, UpdateWidgetTokenDto } from '../dto/widget-chat.dto';

@ApiTags('Widget Tokens (Admin)')
@Controller('admin/agents/:agentId/widget-tokens')
@ApiBearerAuth()
@UseGuards(PermissionsGuard)
@RequirePermissions('agents.update')
export class AdminWidgetController {
  constructor(private readonly widgetChatService: WidgetChatService) {}

  @Post()
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
  async listTokens(@Param('agentId') agentId: string) {
    return this.widgetChatService.listTokens(agentId);
  }

  @Patch(':tokenId')
  async updateToken(
    @Param('agentId') agentId: string,
    @Param('tokenId') tokenId: string,
    @Body() dto: UpdateWidgetTokenDto,
  ) {
    return this.widgetChatService.updateToken(agentId, tokenId, dto);
  }

  @Delete(':tokenId')
  async revokeToken(
    @Param('agentId') agentId: string,
    @Param('tokenId') tokenId: string,
  ) {
    return this.widgetChatService.revokeToken(agentId, tokenId);
  }
}
