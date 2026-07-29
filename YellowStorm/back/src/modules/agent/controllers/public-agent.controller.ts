import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger';
import { AgentService } from '../agent.service';
import { PublicQueryAgentDto } from '../dto';
import { IAgentResponse } from '../interfaces/agent.interface';
import { PaginatedResponseDto } from '../../../common/dto/pagination.dto';
import { Public } from '../../auth/decorators/public.decorator';
import { ApiKeyGuard } from '../../auth/guards/api-key.guard';

/**
 * Public, API-key protected endpoint for third-party services. Returns the
 * list of "humain"-type agents, with optional filters on role, name and
 * description. Secured by a static API key (`X-API-Key` header) instead of the
 * global JWT auth.
 */
@ApiTags('Public Agents')
@ApiSecurity('api-key')
@Public()
@UseGuards(ApiKeyGuard)
@Controller('public/agents')
export class PublicAgentController {
  constructor(private readonly agentService: AgentService) {}

  @Get()
  @ApiOperation({ summary: 'List humain agents for third-party integrations (paginated)' })
  @ApiResponse({ status: 200, description: 'Humain agents retrieved' })
  @ApiResponse({ status: 401, description: 'Missing or invalid API key' })
  async findHumainAgents(
    @Query() query: PublicQueryAgentDto,
  ): Promise<PaginatedResponseDto<IAgentResponse>> {
    return this.agentService.findHumainAgentsPublic(query);
  }
}
