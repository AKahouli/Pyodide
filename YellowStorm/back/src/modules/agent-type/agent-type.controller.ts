import { Controller, Get } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AgentTypeService } from './agent-type.service';
import { IAgentTypeResponse } from './interfaces/agent-type.interface';

@ApiTags('Agent Types')
@ApiBearerAuth()
@Controller('agent-types')
export class AgentTypeController {
  constructor(private readonly agentTypeService: AgentTypeService) {}

  @Get('active')
  @ApiOperation({ summary: 'List all active agent types (for dropdowns)' })
  @ApiResponse({ status: 200, description: 'Active agent types retrieved' })
  async findAllActive(): Promise<IAgentTypeResponse[]> {
    return this.agentTypeService.findAllActive();
  }
}
