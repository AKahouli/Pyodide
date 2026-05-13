import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { PlaybookOwnerGuard } from '../guards/playbook-owner.guard';
import { RequestPlaybookNodeAdvisorDto } from '../dto/request-playbook-node-advisor.dto';
import { PlaybookNodeAdvisorService } from '../services/playbook-node-advisor.service';

@ApiTags('Playbook Node Advisor')
@Controller('playbooks/:id/nodes')
@ApiBearerAuth()
export class PlaybookNodeAdvisorController {
  constructor(private readonly playbookNodeAdvisorService: PlaybookNodeAdvisorService) {}

  @Post(':taskId/advisor')
  @UseGuards(PlaybookOwnerGuard)
  @ApiOperation({ summary: 'Get AI suggestions for a single playbook node without mutating the playbook.' })
  @ApiParam({ name: 'id', description: 'Playbook id' })
  @ApiParam({ name: 'taskId', description: 'Target task id' })
  async advise(
    @Param('id') playbookId: string,
    @Param('taskId') taskId: string,
    @Body() dto: RequestPlaybookNodeAdvisorDto,
  ) {
    return this.playbookNodeAdvisorService.advise(playbookId, taskId, dto);
  }
}
