import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { ToolService } from './tool.service';
import { IToolResponse } from './interfaces/tool.interface';

@ApiTags('Tools')
@ApiBearerAuth()
@Controller('tools')
export class UserToolController {
  constructor(private readonly toolService: ToolService) {}

  @Get('active')
  @ApiOperation({ summary: 'List all active tools' })
  async findAllActive(): Promise<IToolResponse[]> {
    return this.toolService.findAllActive();
  }
}
