import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { Permissions } from '@modules/authorization/constants/permissions';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import {
  CreateHitlBlockerDto,
  CreateHitlMemoryDto,
  NormalizeHitlBlockerDto,
  ResumeHitlInterruptDto,
  UpdateHitlBlockerDto,
  UpdateHitlMemoryDto,
  UpdateHitlPolicyDto,
} from '../dto/playbook-flow-hitl.dto';
import { PlaybookFlowExecutionService } from '../services/playbook-flow-execution.service';
import { PlaybookFlowHitlService } from '../services/playbook-flow-hitl.service';

@ApiTags('Playbook Flow HITL')
@ApiBearerAuth()
@Controller()
@UseGuards(PermissionsGuard)
export class PlaybookFlowHitlController {
  constructor(
    private readonly hitlService: PlaybookFlowHitlService,
    private readonly executionService: PlaybookFlowExecutionService,
  ) {}

  @Get('playbooks/:flowId/hitl/policy')
  @ApiOperation({ summary: 'Get workflow HITL policy' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  getPolicy(@CurrentUser('_id') userId: string, @Param('flowId') flowId: string) {
    return this.hitlService.getPolicy(flowId, userId);
  }

  @Patch('playbooks/:flowId/hitl/policy')
  @ApiOperation({ summary: 'Update workflow HITL policy' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  updatePolicy(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Body() dto: UpdateHitlPolicyDto,
  ) {
    return this.hitlService.updatePolicy(flowId, userId, dto);
  }

  @Get('playbooks/:flowId/nodes/:nodeId/hitl/policy')
  @ApiOperation({ summary: 'Get node HITL policy' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  getNodePolicy(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Param('nodeId') nodeId: string,
  ) {
    return this.hitlService.getNodePolicy(flowId, userId, nodeId);
  }

  @Patch('playbooks/:flowId/nodes/:nodeId/hitl/policy')
  @ApiOperation({ summary: 'Update node HITL policy' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  updateNodePolicy(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Param('nodeId') nodeId: string,
    @Body() dto: UpdateHitlPolicyDto,
  ) {
    return this.hitlService.updateNodePolicy(flowId, userId, nodeId, dto);
  }

  @Get('playbooks/:flowId/hitl/blockers')
  @ApiOperation({ summary: 'List workflow HITL blockers' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  listBlockers(@CurrentUser('_id') userId: string, @Param('flowId') flowId: string) {
    return this.hitlService.listBlockers(flowId, userId);
  }

  @Post('playbooks/:flowId/hitl/blockers')
  @ApiOperation({ summary: 'Create a workflow HITL blocker' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  createBlocker(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Body() dto: CreateHitlBlockerDto,
  ) {
    return this.hitlService.createBlocker(flowId, userId, dto);
  }

  @Post('playbooks/:flowId/hitl/blockers/normalize')
  @ApiOperation({ summary: 'Normalize a natural-language HITL blocker draft' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  normalizeBlocker(@Body() dto: NormalizeHitlBlockerDto) {
    return this.hitlService.normalizeBlocker(dto);
  }

  @Patch('playbooks/:flowId/hitl/blockers/:blockerId')
  @ApiOperation({ summary: 'Update a workflow HITL blocker' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  updateBlocker(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Param('blockerId') blockerId: string,
    @Body() dto: UpdateHitlBlockerDto,
  ) {
    return this.hitlService.updateBlocker(flowId, userId, blockerId, dto);
  }

  @Delete('playbooks/:flowId/hitl/blockers/:blockerId')
  @ApiOperation({ summary: 'Delete a workflow HITL blocker' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  deleteBlocker(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Param('blockerId') blockerId: string,
  ) {
    return this.hitlService.deleteBlocker(flowId, userId, blockerId);
  }

  @Get('playbooks/:flowId/hitl/memories')
  @ApiOperation({ summary: 'List workflow HITL memories' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  listMemories(@CurrentUser('_id') userId: string, @Param('flowId') flowId: string) {
    return this.hitlService.listMemories(flowId, userId);
  }

  @Post('playbooks/:flowId/hitl/memories')
  @ApiOperation({ summary: 'Create workflow HITL memory' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  createMemory(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Body() dto: CreateHitlMemoryDto,
  ) {
    return this.hitlService.createMemory(flowId, userId, dto);
  }

  @Patch('playbooks/:flowId/hitl/memories/:memoryId')
  @ApiOperation({ summary: 'Update workflow HITL memory' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  updateMemory(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Param('memoryId') memoryId: string,
    @Body() dto: UpdateHitlMemoryDto,
  ) {
    return this.hitlService.updateMemory(flowId, userId, memoryId, dto);
  }

  @Delete('playbooks/:flowId/hitl/memories/:memoryId')
  @ApiOperation({ summary: 'Delete workflow HITL memory' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  deleteMemory(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Param('memoryId') memoryId: string,
  ) {
    return this.hitlService.deleteMemory(flowId, userId, memoryId);
  }

  @Get('executions/:executionId/hitl/events')
  @ApiOperation({ summary: 'List execution HITL audit events' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  listExecutionEvents(@CurrentUser('_id') userId: string, @Param('executionId') executionId: string) {
    return this.hitlService.listExecutionEvents(executionId, userId);
  }

  @Get('executions/:executionId/hitl/pending')
  @ApiOperation({ summary: 'Get pending HITL interrupt for an execution' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  getPendingInterrupt(@CurrentUser('_id') userId: string, @Param('executionId') executionId: string) {
    return this.hitlService.getPendingInterrupt(executionId, userId);
  }

  @Post('executions/:executionId/hitl/:interruptId/disable-blocker')
  @ApiOperation({ summary: 'Disable the blocker that created a pending HITL interrupt' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  disableBlocker(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
    @Param('interruptId') interruptId: string,
  ) {
    return this.hitlService.disableBlocker(executionId, userId, interruptId);
  }

  @Post('executions/:executionId/hitl/:interruptId/resume')
  @ApiOperation({ summary: 'Resume a pending HITL interrupt' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async resumeInterrupt(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
    @Param('interruptId') interruptId: string,
    @Body() dto: ResumeHitlInterruptDto,
  ) {
    const pending = await this.hitlService.getPendingInterrupt(executionId, userId) as { nodeId?: string } | null;
    return this.executionService.resumeFromStep(executionId, userId, {
      taskId: dto.taskId ?? pending?.nodeId ?? '',
      action: dto.action,
      interruptId,
      message: dto.message,
      approved: dto.approved,
      reason: dto.reason,
      feedback: dto.feedback,
      scope: dto.scope,
      remember: dto.remember,
      payload: dto.payload,
    });
  }
}
