import {
  Controller,
  Post,
  Param,
  HttpCode,
  HttpStatus,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { A2APublishService } from '../services/a2a-publish.service';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { AgentPermissionGuard, AgentContext } from '../guards/agent-permission.guard';
import { RequireAgentPermission } from '../decorators/require-agent-permission.decorator';
import {
  PublishAgentResult,
  RevokeAgentResult,
  RotateKeyResult,
} from '../types/a2a-admin.types';

@ApiTags('Agents')
@ApiBearerAuth()
@Controller('agents/:agentId/a2a')
export class AgentA2AController {
  constructor(private readonly a2aPublishService: A2APublishService) {}

  @Post('publish')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish a personal agent over the A2A protocol' })
  @ApiParam({ name: 'agentId', description: 'Agent ID' })
  @ApiResponse({ status: 200, description: 'Agent published; API key returned once' })
  @ApiResponse({ status: 403, description: 'Agent is a default agent or not owned by the caller' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async publish(
    @CurrentUser() user: UserDocument,
    @Param('agentId') agentId: string,
    @Req() request: { agentContext: AgentContext },
  ): Promise<PublishAgentResult> {
    return this.a2aPublishService.publish(user._id.toString(), agentId, true);
  }

  @Post('rotate-key')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the A2A API key for a published agent' })
  @ApiParam({ name: 'agentId', description: 'Agent ID' })
  @ApiResponse({ status: 200, description: 'Key rotated; new API key returned once' })
  @ApiResponse({ status: 409, description: 'Agent has not been published over A2A' })
  async rotateKey(
    @CurrentUser() user: UserDocument,
    @Param('agentId') agentId: string,
    @Req() request: { agentContext: AgentContext },
  ): Promise<RotateKeyResult> {
    return this.a2aPublishService.rotateKey(user._id.toString(), agentId, true);
  }

  @Post('revoke')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('write')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Revoke a published A2A agent' })
  @ApiParam({ name: 'agentId', description: 'Agent ID' })
  @ApiResponse({ status: 200, description: 'Agent revoked from the A2A surface' })
  @ApiResponse({ status: 409, description: 'Agent has not been published over A2A' })
  async revoke(
    @CurrentUser() user: UserDocument,
    @Param('agentId') agentId: string,
    @Req() request: { agentContext: AgentContext },
  ): Promise<RevokeAgentResult> {
    return this.a2aPublishService.revokeAgent(user._id.toString(), agentId, true);
  }
}
