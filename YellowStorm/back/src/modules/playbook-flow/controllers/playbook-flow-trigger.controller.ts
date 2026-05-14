import { Controller, Get, Post, Patch, Param, Body, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { PlaybookFlowService } from '../services/playbook-flow.service';
import { PlaybookFlowMailGraphClientService } from '../services/playbook-flow-mail-graph-client.service';
import { CurrentUser } from '@modules/auth/decorators/current-user.decorator';
import { RequirePermissions } from '@modules/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '@modules/authorization/guards/permissions.guard';
import { Permissions } from '@modules/authorization/constants/permissions';

@ApiTags('Playbook Flow Triggers')
@ApiBearerAuth()
@Controller('playbooks')
@UseGuards(PermissionsGuard)
export class PlaybookFlowTriggerController {
  constructor(
    private readonly flowService: PlaybookFlowService,
    private readonly graphClient: PlaybookFlowMailGraphClientService,
  ) {}

  @Get(':id/triggers')
  @ApiOperation({ summary: 'Get trigger configuration for a flow' })
  @RequirePermissions(Permissions.PLAYBOOK_READ)
  async getTriggers(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
  ) {
    const flow = await this.flowService.findOne(flowId, userId);
    return flow.triggerConfig ?? null;
  }

  @Patch(':id/trigger/schedule')
  @ApiOperation({ summary: 'Update schedule trigger config' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async upsertScheduleTrigger(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const flow = await this.flowService.findOne(flowId, userId);
    const currentParams = (flow.triggerConfig?.params ?? {}) as Record<string, unknown>;
    return this.flowService.update(flowId, userId, {
      triggerConfig: { kind: 'schedule', params: { ...currentParams, ...body } },
    } as any);
  }

  @Patch(':id/trigger/mail')
  @ApiOperation({ summary: 'Update mail trigger config' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async upsertMailTrigger(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const flow = await this.flowService.findOne(flowId, userId);
    const currentParams = (flow.triggerConfig?.params ?? {}) as Record<string, unknown>;
    return this.flowService.update(flowId, userId, {
      triggerConfig: { kind: 'mail', params: { ...currentParams, ...body } },
    } as any);
  }

  @Post(':id/trigger/mail/subscription')
  @ApiOperation({ summary: 'Create or renew Graph inbox subscription' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async syncMailSubscription(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Body() body: { notificationUrl: string; autoRenewUntil?: string | null },
  ) {
    const flow = await this.flowService.findOne(flowId, userId);
    const params = (flow.triggerConfig?.params ?? {}) as Record<string, unknown>;
    const mailboxAppKey = (params['mailboxAppKey'] as string) || '';
    const clientState = flowId;

    const result = await this.graphClient.createInboxSubscription(
      userId,
      mailboxAppKey,
      body.notificationUrl,
      clientState,
      body.autoRenewUntil ?? null,
    );

    return this.flowService.update(flowId, userId, {
      triggerConfig: {
        kind: 'mail',
        params: {
          ...params,
          subscriptionId: result.id,
          subscriptionClientState: clientState,
          subscriptionExpiresAt: result.expirationDateTime,
        },
      },
    } as any);
  }
}
