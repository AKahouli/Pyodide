import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { Permissions } from '@modules/authorization/constants/permissions';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { RunFlowExecutionAdvisorDto } from '../dto/run-flow-execution-advisor.dto';
import { PreviewAdvisorRemediationDto } from '../dto/preview-advisor-remediation.dto';
import { PlaybookFlowExecutionAdvisorService } from '../services/advisor/playbook-flow-execution-advisor.service';

@ApiTags('Playbook Flow Execution Advisor')
@ApiBearerAuth()
@Controller()
@UseGuards(PermissionsGuard)
export class PlaybookFlowExecutionAdvisorController {
  constructor(private readonly advisorService: PlaybookFlowExecutionAdvisorService) {}

  @Get('playbooks/:flowId/executions/:executionId/advisor-remediations')
  @ApiOperation({ summary: 'Get advisor remediation items for an execution' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async getRemediations(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Param('executionId') executionId: string,
    @Query('taskId') taskId?: string,
  ) {
    return this.advisorService.getRemediations(executionId, userId, taskId);
  }

  @Post('playbooks/:flowId/advisor-remediations/preview')
  @ApiOperation({ summary: 'Preview advisor remediation as a playbook intent suggestion' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async previewRemediation(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Body() dto: PreviewAdvisorRemediationDto,
  ) {
    return this.advisorService.previewRemediation(flowId, userId, dto);
  }

  @Post('executions/:executionId/tasks/:taskId/advisor-evaluation')
  @ApiOperation({ summary: 'Run advisor evaluation for a completed execution task' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async runTaskEvaluation(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
    @Param('taskId') taskId: string,
    @Body() dto: RunFlowExecutionAdvisorDto,
  ) {
    return this.advisorService.runTaskEvaluation(executionId, taskId, userId, dto);
  }
}
