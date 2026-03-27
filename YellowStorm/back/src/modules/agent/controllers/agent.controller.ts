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
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
} from '@nestjs/swagger';
import { AgentService } from '../agent.service';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserDocument } from '../../user/schemas/user.schema';
import { CreateAgentDto, UpdateAgentDto, QueryAgentDto } from '../dto';
import { IAgentResponse } from '../interfaces/agent.interface';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto';

@ApiTags('Agents')
@ApiBearerAuth()
@Controller('agents')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Get()
  @ApiOperation({ summary: 'List personal agents (paginated)' })
  @ApiResponse({ status: 200, description: 'Personal agents retrieved' })
  async findAll(
    @CurrentUser() user: UserDocument,
    @Query() query: QueryAgentDto,
  ): Promise<PaginatedResponseDto<IAgentResponse>> {
    return this.agentService.findUserAgents(user._id.toString(), query);
  }

  @Get('all')
  @ApiOperation({ summary: 'Get all agents for user (personal + defaults, no pagination)' })
  @ApiResponse({ status: 200, description: 'All agents retrieved' })
  async findAllForUser(@CurrentUser() user: UserDocument): Promise<IAgentResponse[]> {
    return this.agentService.getAllForUserResponse(user._id.toString());
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get personal agent by ID' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  @ApiResponse({ status: 200, description: 'Agent retrieved' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async findById(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<IAgentResponse> {
    return this.agentService.findUserAgentById(user._id.toString(), id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a personal agent' })
  @ApiResponse({ status: 201, description: 'Agent created' })
  @ApiResponse({ status: 409, description: 'Agent name already exists' })
  async create(
    @CurrentUser() user: UserDocument,
    @Body() dto: CreateAgentDto,
  ): Promise<IAgentResponse> {
    return this.agentService.createPersonal(user._id.toString(), dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a personal agent' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  @ApiResponse({ status: 200, description: 'Agent updated' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async update(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
    @Body() dto: UpdateAgentDto,
  ): Promise<IAgentResponse> {
    return this.agentService.updatePersonal(user._id.toString(), id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a personal agent' })
  @ApiParam({ name: 'id', description: 'Agent ID' })
  @ApiResponse({ status: 204, description: 'Agent deleted' })
  @ApiResponse({ status: 404, description: 'Agent not found' })
  async delete(
    @CurrentUser() user: UserDocument,
    @Param('id') id: string,
  ): Promise<void> {
    return this.agentService.deletePersonal(user._id.toString(), id);
  }
}
