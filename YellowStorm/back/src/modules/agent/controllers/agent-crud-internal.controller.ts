import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Req,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../../auth/decorators/public.decorator';
import { InternalServiceGuard } from '../../auth/guards/internal-service.guard';
import { AgentCrudActorGuard, actingUserIdFrom } from '../../auth/guards/agent-crud-actor.guard';
import { AgentService } from '../agent.service';
import { AgentTypeService } from '../../agent-type/agent-type.service';
import { ModelsService } from '../../models/models.service';
import { CreateAgentDto, UpdateAgentDto } from '../dto';
import { InternalCreateAgentDto } from '../dto/internal-create-agent.dto';
import { IAgentResponse } from '../interfaces/agent.interface';

/**
 * Trusted service-to-service agent CRUD surface for the mcp-agent MCP server
 * (Streamable HTTP connector `agent-mcp`). Authenticated with X-Internal-Token
 * plus the acting user identity stamped on the connector binding; every
 * operation runs as that user through the same services as the REST API.
 */
@ApiTags('Agent CRUD Internal')
@Public()
@Controller('internal/agent-crud')
@UseGuards(InternalServiceGuard, AgentCrudActorGuard)
export class AgentCrudInternalController {
  constructor(
    private readonly agentService: AgentService,
    private readonly agentTypeService: AgentTypeService,
    private readonly modelsService: ModelsService,
  ) {}

  @Get('agent-types')
  @ApiOperation({ summary: 'List active agent types for the acting user' })
  async listAgentTypes() {
    return this.agentTypeService.findAllActive();
  }

  @Get('models')
  @ApiOperation({ summary: 'List available LLM models for the acting user' })
  async listModels() {
    return this.modelsService.findAll(true);
  }

  @Get('agents')
  @ApiOperation({ summary: 'List all agents visible to the acting user' })
  async listAgents(@Req() request: { headers: Record<string, string | string[] | undefined> }): Promise<IAgentResponse[]> {
    return this.agentService.getAllForUserResponse(actingUserIdFrom(request.headers));
  }

  @Get('agents/:id')
  @ApiOperation({ summary: 'Get one agent by id' })
  async getAgent(
    @Req() request: { headers: Record<string, string | string[] | undefined> },
    @Param('id') id: string,
  ): Promise<IAgentResponse> {
    return this.agentService.findUserAgentById(actingUserIdFrom(request.headers), id);
  }

  @Post('agents')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a personal agent owned by the acting user' })
  async createAgent(
    @Req() request: { headers: Record<string, string | string[] | undefined> },
    @Body() dto: InternalCreateAgentDto,
  ): Promise<IAgentResponse> {
    const createDto = {
      name: dto.name,
      slug: dto.name,
      agentType: dto.agentType,
      role: dto.role,
      description: dto.description,
      temperature: dto.temperature,
      model: dto.model,
      instruction: dto.instruction,
      ignorePrePrompt: dto.ignorePrePrompt,
      tools: dto.tools,
    } as CreateAgentDto;
    return this.agentService.createPersonal(actingUserIdFrom(request.headers), createDto);
  }

  @Patch('agents/:id')
  @ApiOperation({ summary: 'Update a personal agent owned by the acting user' })
  async updateAgent(
    @Req() request: { headers: Record<string, string | string[] | undefined> },
    @Param('id') id: string,
    @Body() dto: UpdateAgentDto,
  ): Promise<IAgentResponse> {
    return this.agentService.updatePersonal(actingUserIdFrom(request.headers), id, dto);
  }

  @Delete('agents/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a personal agent owned by the acting user' })
  async deleteAgent(
    @Req() request: { headers: Record<string, string | string[] | undefined> },
    @Param('id') id: string,
  ): Promise<void> {
    await this.agentService.deletePersonal(actingUserIdFrom(request.headers), id);
  }
}
