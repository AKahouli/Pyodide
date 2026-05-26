import { Controller, Get, Post, Patch, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PlaybookFlowOutputFormatService } from '../services/playbook-flow-output-format.service';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { Permissions } from '@modules/authorization/constants/permissions';

@ApiTags('Playbook Flows')
@ApiBearerAuth()
@Controller('playbooks/:id/tasks')
@UseGuards(PermissionsGuard)
export class PlaybookFlowOutputFormatController {
  constructor(private readonly outputFormatService: PlaybookFlowOutputFormatService) {}

  @Post(':taskId/output-format-template')
  @ApiOperation({ summary: 'Capture output format template from an execution' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async captureFromExecution(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Body() body: { executionId: string },
  ) {
    return this.outputFormatService.captureFromExecution(userId, flowId, taskId, body.executionId);
  }

  @Get(':taskId/output-format-template')
  @ApiOperation({ summary: 'Get active output format template for a task' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async getActiveTemplate(
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
  ) {
    return this.outputFormatService.getActiveTemplate(flowId, taskId);
  }

  @Patch(':taskId/output-format-template')
  @ApiOperation({ summary: 'Update output format template for a task' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async updateTemplate(
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Body() dto: { formatGuide?: string; preserveOutputFormat?: boolean },
  ) {
    return this.outputFormatService.updateTemplate(flowId, taskId, dto);
  }

  @Delete(':taskId/output-format-template')
  @ApiOperation({ summary: 'Delete output format template for a task' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async deleteTemplate(
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
  ) {
    await this.outputFormatService.deleteTemplate(flowId, taskId);
  }
}
