import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiParam } from '@nestjs/swagger';
import { AgentShareService } from '../services/agent-share.service';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { ShareAgentDto, UpdateAgentSharePermissionDto } from '../dto';
import { IAgentShareEntry } from '../interfaces/agent.interface';
import { AgentPermissionGuard } from '../guards/agent-permission.guard';
import { RequireAgentPermission } from '../decorators/require-agent-permission.decorator';

@ApiTags('Agent Sharing')
@ApiBearerAuth()
@Controller('agents')
export class AgentShareController {
  constructor(private readonly agentShareService: AgentShareService) {}

  @Post(':id/shares')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('owner')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Share an agent with users by email' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  async shareAgent(
    @CurrentUser() user: AuthUser,
    @Param('id') agentId: string,
    @Body() dto: ShareAgentDto,
  ): Promise<IAgentShareEntry[]> {
    return this.agentShareService.shareAgent(user._id.toString(), agentId, dto);
  }

  @Get(':id/shares')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('owner')
  @ApiOperation({ summary: 'List all shares for an agent' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  async getAgentShares(@Param('id') agentId: string): Promise<IAgentShareEntry[]> {
    return this.agentShareService.getAgentShares(agentId);
  }

  @Patch(':id/shares/:shareId')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('owner')
  @ApiOperation({ summary: 'Update a share permission' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  @ApiParam({ name: 'shareId', description: 'Share ID' })
  async updateSharePermission(
    @Param('id') agentId: string,
    @Param('shareId') shareId: string,
    @Body() dto: UpdateAgentSharePermissionDto,
  ): Promise<IAgentShareEntry> {
    return this.agentShareService.updateSharePermission(agentId, shareId, dto);
  }

  @Delete(':id/shares/:shareId')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('owner')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke a share' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  @ApiParam({ name: 'shareId', description: 'Share ID' })
  async removeShare(
    @Param('id') agentId: string,
    @Param('shareId') shareId: string,
  ): Promise<void> {
    return this.agentShareService.removeShare(agentId, shareId);
  }

  @Delete(':id/unshare')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove a shared agent from your list' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  async unshareFromSelf(
    @CurrentUser() user: AuthUser,
    @Param('id') agentId: string,
  ): Promise<void> {
    return this.agentShareService.unshareFromSelf(user._id.toString(), agentId);
  }
}
