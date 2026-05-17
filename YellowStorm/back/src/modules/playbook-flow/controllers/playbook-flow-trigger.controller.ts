import { Controller, Get, Post, Patch, Put, Delete, Param, Body, UseGuards } from '@nestjs/common';
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

  private async updateTriggerConfig(
    userId: string,
    flowId: string,
    kind: 'schedule' | 'mail',
    body: Record<string, unknown>,
  ) {
    const flow = await this.flowService.findOne(flowId, userId);
    const currentParams = (flow.triggerConfig?.params ?? {}) as Record<string, unknown>;

    return this.flowService.update(flowId, userId, {
      triggerConfig: { kind, params: { ...currentParams, ...body } },
    } as any);
  }

  private async disableTrigger(
    userId: string,
    flowId: string,
    kind: 'schedule' | 'mail',
  ) {
    const flow = await this.flowService.findOne(flowId, userId);
    const currentKind = flow.triggerConfig?.kind;

    // Compatibility delete routes should never reclassify a different stored trigger kind.
    if (currentKind && currentKind !== kind) {
      return flow;
    }

    const currentParams = (flow.triggerConfig?.params ?? {}) as Record<string, unknown>;

    return this.flowService.update(flowId, userId, {
      triggerConfig: {
        kind: currentKind === 'mail' ? 'mail' : kind,
        params: { ...currentParams, enabled: false },
      },
    } as any);
  }

  @Patch(':id/trigger/schedule')
  @ApiOperation({ summary: 'Update schedule trigger config' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async upsertScheduleTrigger(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.updateTriggerConfig(userId, flowId, 'schedule', body);
  }

  @Put(':id/triggers/schedule')
  @ApiOperation({ summary: 'Update schedule trigger config (compat)' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async upsertScheduleTriggerCompat(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.updateTriggerConfig(userId, flowId, 'schedule', body);
  }

  @Delete(':id/triggers/schedule')
  @ApiOperation({ summary: 'Disable schedule trigger config (compat)' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async clearScheduleTriggerCompat(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
  ) {
    return this.disableTrigger(userId, flowId, 'schedule');
  }

  @Patch(':id/trigger/mail')
  @ApiOperation({ summary: 'Update mail trigger config' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async upsertMailTrigger(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.updateTriggerConfig(userId, flowId, 'mail', body);
  }

  @Put(':id/triggers/mail')
  @ApiOperation({ summary: 'Update mail trigger config (compat)' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async upsertMailTriggerCompat(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.updateTriggerConfig(userId, flowId, 'mail', body);
  }

  @Delete(':id/triggers/mail')
  @ApiOperation({ summary: 'Disable mail trigger config (compat)' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async clearMailTriggerCompat(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
  ) {
    return this.disableTrigger(userId, flowId, 'mail');
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

  @Post(':id/triggers/mail/sync-subscription')
  @ApiOperation({ summary: 'Create or renew Graph inbox subscription (compat)' })
  @RequirePermissions(Permissions.PLAYBOOK_UPDATE)
  async syncMailSubscriptionCompat(
    @CurrentUser('_id') userId: string,
    @Param('id') flowId: string,
    @Body() body: { notificationUrl: string; autoRenewUntil?: string | null },
  ) {
    return this.syncMailSubscription(userId, flowId, body);
  }
}
