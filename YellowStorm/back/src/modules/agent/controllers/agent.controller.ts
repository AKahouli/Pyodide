import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
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
import { Request } from 'express';
import { AgentService } from '../agent.service';
import { RootDelegateResolverService, RootDelegatePool } from '../services/root-delegate-resolver.service';
import { AuditLogService } from '../../authorization/services/audit-log.service';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { CreateAgentDto, UpdateAgentDto, QueryAgentDto } from '../dto';
import { IAgentResponse } from '../interfaces/agent.interface';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto';
import { AgentPermissionGuard, AgentContext } from '../guards/agent-permission.guard';
import { RequireAgentPermission } from '../decorators/require-agent-permission.decorator';

@ApiTags('Agents')
@ApiBearerAuth()
@Controller('agents')
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly rootDelegateResolver: RootDelegateResolverService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List personal agents (paginated)' })
  @ApiResponse({ status: 200, description: 'Personal agents retrieved' })
  async findAll(
    @CurrentUser() user: AuthUser,
    @Query() query: QueryAgentDto,
  ): Promise<PaginatedResponseDto<IAgentResponse>> {
    return this.agentService.findUserAgents(user._id.toString(), query);
  }

  @Get('all')
  @ApiOperation({ summary: 'Get all agents for user (personal + defaults, no pagination)' })
  @ApiResponse({ status: 200, description: 'All agents retrieved' })
  async findAllForUser(@CurrentUser() user: AuthUser): Promise<IAgentResponse[]> {
    return this.agentService.getAllForUserResponse(user._id.toString());
  }

  @Get('humain/resolve')
  @ApiOperation({
    summary: 'Resolve humain agents by id (cross-user delegation display, e.g. Worky streams)',
  })
  @ApiResponse({ status: 200, description: 'Humain agents resolved' })
  async resolveHumain(
    @Query('ids') ids?: string,
  ): Promise<{ id: string; name: string; slug: string; role: string }[]> {
    const list = (ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.agentService.resolveHumainByIds(list);
  }

  @Get(':id/root-delegates/effective-pool')
  @ApiOperation({ summary: 'Effective delegate pool of a root (WP02 resolution)' })
  @ApiResponse({ status: 200, description: 'Flattened, authorized delegate catalog' })
  async getEffectivePool(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<RootDelegatePool> {
    return this.rootDelegateResolver.resolveForActor(id, user._id.toString());
  }

  @Get(':id')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('read')
  @ApiOperation({ summary: 'Get personal agent by ID' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  @ApiResponse({ status: 200, description: 'Agent retrieved' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async findById(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Req() request: { agentContext: AgentContext },
  ): Promise<IAgentResponse> {
    if (request.agentContext.agent.isDefault) {
      return this.agentService.findDefaultAgentById(id);
    }
    return this.agentService.findUserAgentById(user._id.toString(), id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a personal agent' })
  @ApiResponse({ status: 201, description: 'Agent created' })
  @ApiResponse({ status: 409, description: 'Agent name already exists' })
  async create(
    @CurrentUser() user: AuthUser,
    @Body() dto: CreateAgentDto,
  ): Promise<IAgentResponse> {
    return this.agentService.createPersonal(user._id.toString(), dto);
  }

  @Patch(':id')
  @UseGuards(AgentPermissionGuard)
  @RequireAgentPermission('write')
  @ApiOperation({ summary: 'Update a personal agent' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  @ApiResponse({ status: 200, description: 'Agent updated' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: UpdateAgentDto,
    @Req() request: Request & { agentContext: AgentContext },
  ): Promise<IAgentResponse> {
    if (request.agentContext.agent.isDefault) {
      const agent = await this.agentService.updateDefault(id, dto);
      this.auditLogService.logSuccess({
        actorId: user._id.toString(),
        actorEmail: user.email,
        action: 'agents.update',
        targetId: agent.id,
        targetType: 'Agent',
        metadata: { agentName: agent.name, changes: dto },
        ipAddress: request.ip,
        userAgent: request.headers['user-agent'],
      });
      return agent;
    }
    return this.agentService.updatePersonal(user._id.toString(), id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a personal agent' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  @ApiResponse({ status: 204, description: 'Agent deleted' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async delete(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ): Promise<void> {
    return this.agentService.deletePersonal(user._id.toString(), id);
  }
}
