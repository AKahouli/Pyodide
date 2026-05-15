import {
  Controller, Get, Post, Param, Body, Query, UseGuards, Headers, Req,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { PlaybookFlowExecutionService } from '../services/playbook-flow-execution.service';
import { PlaybookFlowReplayService } from '../services/playbook-flow-replay.service';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { Permissions } from '@modules/authorization/constants/permissions';
import { Request } from 'express';

@ApiTags('Playbook Flow Executions')
@ApiBearerAuth()
@Controller()
@UseGuards(PermissionsGuard)
export class PlaybookFlowExecutionController {
  constructor(
    private readonly executionService: PlaybookFlowExecutionService,
    private readonly replayService: PlaybookFlowReplayService,
  ) {}

  @Post('playbooks/:flowId/executions')
  @ApiOperation({ summary: 'Start a playbook flow execution' })
  @ApiHeader({ name: 'Idempotency-Key', required: false })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async start(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Body() body: any,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    const execution = await this.executionService.start(flowId, userId, body.inputContext, idempotencyKey);
    return { executionId: (execution as any).id ?? (execution as any)._id?.toString() };
  }

  @Get('playbooks/:flowId/executions')
  @ApiOperation({ summary: 'List executions for a flow' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async findAll(
    @CurrentUser('_id') userId: string,
    @Param('flowId') flowId: string,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    return this.executionService.findAll(flowId, userId, page || 1, limit || 10);
  }

  @Get('executions/:executionId')
  @ApiOperation({ summary: 'Get execution detail with task results and router decisions' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async findOne(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executionService.findOne(executionId, userId);
  }

  @Post('executions/:executionId/cancel')
  @ApiOperation({ summary: 'Cancel a running execution' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async cancel(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.executionService.cancel(executionId, userId);
  }

  @Post('executions/:executionId/resume-approval')
  @ApiOperation({ summary: 'Resume a pending-approval execution' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async resumeApproval(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
    @Body() body: { decision: string; payload?: Record<string, unknown> },
  ) {
    return this.executionService.resumeApproval(executionId, userId, body);
  }

  @Post('executions/:executionId/trace-replay')
  @ApiOperation({ summary: 'Trace replay an execution deterministically from recorded events' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async traceReplay(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.replayService.traceReplay(executionId, userId);
  }

  @Post('executions/:executionId/re-execute')
  @ApiOperation({ summary: 'Re-execute a flow with the same inputs (may diverge)' })
  @RequirePermissions(Permissions.PLAYBOOK_EXECUTE)
  async reExecute(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
  ) {
    return this.replayService.reExecute(executionId, userId);
  }

  @Get('executions/:executionId/router-decisions')
  @ApiOperation({ summary: 'Get router decisions for trace replay' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async getRouterDecisions(
    @CurrentUser('_id') userId: string,
    @Param('executionId') executionId: string,
  ) {
    const detail = await this.executionService.findOne(executionId, userId);
    return detail.routerDecisions;
  }
}
