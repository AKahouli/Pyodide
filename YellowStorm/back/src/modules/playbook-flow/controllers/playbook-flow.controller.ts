import { Controller, Get, Post, Patch, Delete, Param, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PlaybookFlowService } from '../services/playbook-flow.service';
import { PlaybookFlowEvaluationService } from '../services/playbook-flow-evaluation.service';
import { CreatePlaybookFlowDto } from '../dto/create-playbook-flow.dto';
import { UpdatePlaybookFlowDto } from '../dto/update-playbook-flow.dto';
import { PlaybookFlowQueryDto } from '../dto/playbook-flow-query.dto';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { Permissions } from '@modules/authorization/constants/permissions';

@ApiTags('Playbook Flows')
@ApiBearerAuth()
@Controller('playbooks')
@UseGuards(PermissionsGuard)
export class PlaybookFlowController {
  constructor(
    private readonly playbookFlowService: PlaybookFlowService,
    private readonly evaluationService: PlaybookFlowEvaluationService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new playbook flow' })
  @RequirePermissions(Permissions.PLAYBOOK_CREATE)
  async create(
    @CurrentUser('_id') userId: string,
    @Body() dto: CreatePlaybookFlowDto,
  ) {
    return this.playbookFlowService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List playbook flows' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async findAll(
    @CurrentUser('_id') userId: string,
    @Query() query: PlaybookFlowQueryDto,
  ) {
    return this.playbookFlowService.findAll(userId, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a playbook flow by id' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async findOne(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
  ) {
    return this.playbookFlowService.findOne(id, userId);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a playbook flow' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async update(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePlaybookFlowDto,
  ) {
    return this.playbookFlowService.update(id, userId, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a playbook flow' })
  @RequirePermissions(Permissions.PLAYBOOK_DELETE)
  async remove(
    @CurrentUser('_id') userId: string,
    @Param('id') id: string,
  ) {
    return this.playbookFlowService.remove(id, userId);
  }

  @Get(':id/evaluations')
  @ApiOperation({ summary: 'List evaluation executions for a flow' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async listEvaluations(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Query('taskId') taskId?: string,
  ) {
    return this.evaluationService.listEvaluationExecutions(flowId, taskId);
  }

  @Get(':id/evaluation-tasks/:taskId/baseline')
  @ApiOperation({ summary: 'Get active evaluation baseline for a task' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async getBaseline(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Query('iteration') iteration?: number,
  ) {
    return this.evaluationService.getActiveBaseline(flowId, taskId, iteration);
  }

  @Post(':id/evaluation-tasks/:taskId/baseline/from-execution')
  @ApiOperation({ summary: 'Create evaluation baseline from an execution' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async createBaselineFromExecution(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Body() body: { executionId: string; iteration?: number },
  ) {
    return this.evaluationService.replaceBaselineFromExecution(
      flowId, taskId, body.iteration ?? 0, body.executionId, userId,
    );
  }

  @Post(':id/evaluation-tasks/:taskId/baseline/from-current-execution')
  @ApiOperation({ summary: 'Create evaluation baseline from current evaluation execution' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async createBaselineFromCurrentExecution(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
    @Body() body: { executionId: string; evaluationExecutionId: string; iteration?: number },
  ) {
    return this.evaluationService.replaceBaselineFromCurrentEvaluationExecution(
      flowId, taskId, body.iteration ?? 0, body.executionId, body.evaluationExecutionId, userId,
    );
  }

  @Delete(':id/evaluation-tasks/:taskId/baseline')
  @ApiOperation({ summary: 'Delete evaluation baseline for a task' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async deleteBaseline(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Param('taskId') taskId: string,
  ) {
    await this.evaluationService.removeActiveBaseline(flowId, taskId);
  }
}
