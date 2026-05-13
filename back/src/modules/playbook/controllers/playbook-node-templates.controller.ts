import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PlaybookNodeTemplateService } from '../services/playbook-node-template.service';

@ApiTags('Playbook Node Templates')
@Controller('playbook-node-templates')
export class PlaybookNodeTemplatesController {
  constructor(private readonly templateService: PlaybookNodeTemplateService) {}

  @Get()
  @ApiOperation({ summary: 'List enabled playbook node templates' })
  @ApiResponse({ status: 200, description: 'Enabled node templates retrieved' })
  async list() {
    return this.templateService.findEnabled();
  }
}
