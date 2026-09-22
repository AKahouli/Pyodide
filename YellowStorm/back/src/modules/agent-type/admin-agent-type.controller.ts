import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Put,
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
import { AgentTypeService } from './agent-type.service';
import { AgentService } from '../agent/agent.service';
import { AuditLogService } from '../authorization/services/audit-log.service';
import { ConflictException } from '../exceptions';
import { ErrorCode } from '../exceptions/constants/error-codes';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { AuthUser } from '@common/auth/auth-user';
import { Permissions } from '../authorization/constants/permissions';
import {
  CreateAgentTypeDto,
  UpdateAgentTypeDto,
  QueryAgentTypeDto,
  UpsertAgentTypePromptDto,
} from './dto';
import { IAgentTypeResponse } from './interfaces/agent-type.interface';
import { IAgentTypePromptResponse } from './interfaces/agent-type-prompt.interface';
import { PaginatedResponseDto } from '../../common/dto/pagination.dto';

@ApiTags('Admin Agent Types')
@ApiBearerAuth()
@Controller('admin/agent-types')
@UseGuards(PermissionsGuard)
export class AdminAgentTypeController {
  constructor(
    private readonly agentTypeService: AgentTypeService,
    private readonly agentService: AgentService,
    private readonly auditLogService: AuditLogService,
  ) {}

  @Get()
  @RequirePermissions(Permissions.AGENT_TYPES_READ)
  @ApiOperation({ summary: 'List agent types (paginated)' })
  @ApiResponse({ status: 200, description: 'Agent types retrieved' })
  async findAll(@Query() query: QueryAgentTypeDto): Promise<PaginatedResponseDto<IAgentTypeResponse>> {
    return this.agentTypeService.findAll(query);
  }

  @Get(':id')
  @RequirePermissions(Permissions.AGENT_TYPES_READ)
  @ApiOperation({ summary: 'Get agent type by ID' })
  @ApiParam({ name: 'id', description: 'Agent type ID' })
  @ApiResponse({ status: 200, description: 'Agent type retrieved' })
  @ApiResponse({ status: 404, description: 'Agent type not found' })
  async findById(@Param('id') id: string): Promise<IAgentTypeResponse> {
    return this.agentTypeService.findById(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(Permissions.AGENT_TYPES_CREATE)
  @ApiOperation({ summary: 'Create a new agent type' })
  @ApiResponse({ status: 201, description: 'Agent type created' })
  @ApiResponse({ status: 409, description: 'Agent type name already exists' })
  async create(
    @Body() dto: CreateAgentTypeDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<IAgentTypeResponse> {
    const agentType = await this.agentTypeService.create(dto);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'agent_types.create',
      targetId: agentType.id,
      targetType: 'AgentType',
      metadata: { agentTypeName: agentType.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return agentType;
  }

  @Patch(':id')
  @RequirePermissions(Permissions.AGENT_TYPES_UPDATE)
  @ApiOperation({ summary: 'Update an agent type' })
  @ApiParam({ name: 'id', description: 'Agent type ID' })
  @ApiResponse({ status: 200, description: 'Agent type updated' })
  @ApiResponse({ status: 404, description: 'Agent type not found' })
  @ApiResponse({ status: 409, description: 'Agent type name already exists' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateAgentTypeDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<IAgentTypeResponse> {
    const agentType = await this.agentTypeService.update(id, dto);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'agent_types.update',
      targetId: agentType.id,
      targetType: 'AgentType',
      metadata: { agentTypeName: agentType.name, changes: dto },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return agentType;
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.AGENT_TYPES_DELETE)
  @ApiOperation({ summary: 'Delete an agent type' })
  @ApiParam({ name: 'id', description: 'Agent type ID' })
  @ApiResponse({ status: 204, description: 'Agent type deleted' })
  @ApiResponse({ status: 404, description: 'Agent type not found' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    const agentCount = await this.agentService.countByAgentType(id);
    if (agentCount > 0) {
      throw new ConflictException(ErrorCode.AGENT_TYPE_IN_USE);
    }

    const agentType = await this.agentTypeService.findById(id);

    await this.agentTypeService.delete(id);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'agent_types.delete',
      targetId: id,
      targetType: 'AgentType',
      metadata: { agentTypeName: agentType.name },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  // ==========================================
  // Model-Specific Prompt Endpoints
  // ==========================================

  @Get(':id/prompts')
  @RequirePermissions(Permissions.AGENT_TYPES_READ)
  @ApiOperation({ summary: 'List all model-specific prompts for an agent type' })
  @ApiParam({ name: 'id', description: 'Agent type ID' })
  @ApiResponse({ status: 200, description: 'Prompts retrieved' })
  @ApiResponse({ status: 404, description: 'Agent type not found' })
  async getPrompts(@Param('id') id: string): Promise<IAgentTypePromptResponse[]> {
    return this.agentTypeService.getPromptsForAgentType(id);
  }

  @Put(':id/prompts/:modelId')
  @RequirePermissions(Permissions.AGENT_TYPES_UPDATE)
  @ApiOperation({ summary: 'Create or update a model-specific prompt' })
  @ApiParam({ name: 'id', description: 'Agent type ID' })
  @ApiParam({ name: 'modelId', description: 'Model ID (e.g. gpt-4o)' })
  @ApiResponse({ status: 200, description: 'Prompt upserted' })
  @ApiResponse({ status: 404, description: 'Agent type not found' })
  async upsertPrompt(
    @Param('id') id: string,
    @Param('modelId') modelId: string,
    @Body() dto: UpsertAgentTypePromptDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<IAgentTypePromptResponse> {
    const result = await this.agentTypeService.upsertPrompt(id, modelId, dto.prompt);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'agent_types.upsert_prompt',
      targetId: id,
      targetType: 'AgentTypePrompt',
      metadata: { modelId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    return result;
  }

  @Delete(':id/prompts/:modelId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(Permissions.AGENT_TYPES_UPDATE)
  @ApiOperation({ summary: 'Delete a model-specific prompt' })
  @ApiParam({ name: 'id', description: 'Agent type ID' })
  @ApiParam({ name: 'modelId', description: 'Model ID (e.g. gpt-4o)' })
  @ApiResponse({ status: 204, description: 'Prompt deleted' })
  @ApiResponse({ status: 404, description: 'Prompt not found' })
  async deletePrompt(
    @Param('id') id: string,
    @Param('modelId') modelId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ): Promise<void> {
    await this.agentTypeService.deletePrompt(id, modelId);

    this.auditLogService.logSuccess({
      actorId: user._id.toString(),
      actorEmail: user.email,
      action: 'agent_types.delete_prompt',
      targetId: id,
      targetType: 'AgentTypePrompt',
      metadata: { modelId },
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
  }
}
