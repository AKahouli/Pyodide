import { Controller, Post, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PlaybookFlowAdvisorService, FlowNodeAdvisorRequest } from '../services/playbook-flow-advisor.service';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { Permissions } from '@modules/authorization/constants/permissions';

@ApiTags('Playbook Flows')
@ApiBearerAuth()
@Controller('playbooks/:id/nodes')
@UseGuards(PermissionsGuard)
export class PlaybookFlowAdvisorController {
  constructor(private readonly advisorService: PlaybookFlowAdvisorService) {}

  @Post(':nodeId/advisor')
  @ApiOperation({ summary: 'Get AI suggestions for a flow node' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async adviseNode(
    @Param('id') flowId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: FlowNodeAdvisorRequest,
  ) {
    return this.advisorService.adviseNode(flowId, nodeId, dto);
  }
}
