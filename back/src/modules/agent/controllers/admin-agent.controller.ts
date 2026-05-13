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
import { AuditLogService } from '../../authorization/services/audit-log.service';
import { RequirePermissions } from '../../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../authorization/guards/permissions.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { Permissions } from '../../authorization/constants/permissions';
import { CreateAgentDto, UpdateAgentDto, QueryAgentDto } from '../dto';
import { IAgentResponse } from '../interfaces/agent.interface';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto';

@ApiTags('Admin Agents')
@ApiBearerAuth()
@Controller('admin/agents')
@UseGuards(PermissionsGuard)
export class AdminAgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.AGENTS_READ)
  @ApiOperation({ summary: 'List default agents (paginated)' })
  @ApiResponse({ status: 200, description: 'Default agents retrieved' })
  async findAll(@Query() query: QueryAgentDto): Promise<PaginatedResponseDto<IAgentResponse>> {
    return this.agentService.findDefaultAgents(query);
  }

  @Get(':id')
  @RequirePermissions(Permissions.AGENTS_READ)
  @ApiOperation({ summary: 'Get default agent by ID' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  @ApiResponse({ status: 200, description: 'Agent retrieved' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async findById(@Param('id') id: string): Promise<IAgentResponse> {
    return this.agentService.findDefaultAgentById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permissions.AGENTS_CREATE)
  @ApiOperation({ summary: 'Create a default agent' })
  @ApiResponse({ status: 201, description: 'Default agent created' })
  @ApiResponse({ status: 409, description: 'Agent name already exists' })
  async create(
    @Body() dto: CreateAgentDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<IAgentResponse> {
    const agent = await this.agentService.createDefault(user._id.toString(), dto);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'agents.create',
      targetId: agent.id,
      targetType: 'Agent',
      metadata: { agentName: agent.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return agent;
  }

  @Patch(':id')
  @RequirePermissions(Permissions.AGENTS_UPDATE)
  @ApiOperation({ summary: 'Update a default agent' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  @ApiResponse({ status: 200, description: 'Agent updated' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAgentDto,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<IAgentResponse> {
    const agent = await this.agentService.updateDefault(id, dto);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'agents.update',
      targetId: agent.id,
      targetType: 'Agent',
      metadata: { agentName: agent.name, changes: dto },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return agent;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.AGENTS_DELETE)
  @ApiOperation({ summary: 'Delete a default agent' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  @ApiResponse({ status: 204, description: 'Agent deleted' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: UserDocument,
    @Req() req: Request,
  ): Promise<void> {
    const agent = await this.agentService.findDefaultAgentById(id);

    await this.agentService.deleteDefault(id);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'agents.delete',
      targetId: id,
      targetType: 'Agent',
      metadata: { agentName: agent.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
