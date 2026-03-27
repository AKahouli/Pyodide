import { Controller, Delete, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { PlaybookService } from '../services/playbook.service';
import { PlaybookOwnerGuard } from '../guards/playbook-owner.guard';
import { ExecutionQueryDto } from '../dto/execution-query.dto';

@ApiTags('Playbook Executions')
@Controller('playbooks/:id/executions')
@ApiBearerAuth()
export class PlaybookExecutionController {
  constructor(private readonly playbookService: PlaybookService) {}

  @Get()
  @UseGuards(PlaybookOwnerGuard)
  async listExecutions(
    @Param('id') playbookId: string,
    @Query() query: ExecutionQueryDto,
  ) {
    return this.playbookService.findExecutionsByPlaybook(playbookId, query);
  }

  @Get(':execId')
  @UseGuards(PlaybookOwnerGuard)
  async getExecution(
    @Param('id') playbookId: string,
    @Param('execId') execId: string,
  ) {
    return this.playbookService.findExecutionById(playbookId, execId);
  }

  @Delete()
  @UseGuards(PlaybookOwnerGuard)
  async deleteExecutions(
    @Param('id') playbookId: string,
  ) {
    return this.playbookService.deleteExecutions(playbookId);
  }

  @Delete(':execId')
  @UseGuards(PlaybookOwnerGuard)
  async deleteExecution(
    @Param('id') playbookId: string,
    @Param('execId') execId: string,
  ) {
    await this.playbookService.deleteExecution(playbookId, execId);
    return { success: true };
  }
}
