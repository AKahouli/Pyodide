import { Types } from 'mongoose';
import { PlaybookFlowTriggerController } from './playbook-flow-trigger.controller';

describe('PlaybookFlowTriggerController', () => {
  const userId = '507f1f77bcf86cd799439011';
  const flowId = String(new Types.ObjectId());

  const makeFlowService = (flow: Record<string, unknown>, updateResult: Record<string, unknown>) => ({
    findOneForWrite: jest.fn().mockResolvedValue(flow),
    update: jest.fn().mockResolvedValue(updateResult),
  });

  const makeGraphClient = () => ({
    createInboxSubscription: jest.fn().mockResolvedValue({
      subscription: {
        id: 'sub-1',
        expirationDateTime: '2026-06-16T00:00:00.000Z',
      },
      resolvedAppKey: 'm365',
    }),
  });

  it('returns triggerConfig when present', async () => {
    const flow = { id: flowId, triggerConfig: { kind: 'schedule', params: { enabled: true, timezone: 'UTC' } } };
    const flowService = makeFlowService(flow, {});
    const graphClient = makeGraphClient();
    const controller = new PlaybookFlowTriggerController(flowService as any, graphClient as any);

    const result = await controller.getTriggers(userId, flowId);
    expect(result).toEqual({ kind: 'schedule', params: { enabled: true, timezone: 'UTC' } });
  });

  it('returns null when no triggerConfig is present', async () => {
    const flow = { id: flowId, triggerConfig: undefined };
    const flowService = makeFlowService(flow, {});
    const graphClient = makeGraphClient();
    const controller = new PlaybookFlowTriggerController(flowService as any, graphClient as any);

    const result = await controller.getTriggers(userId, flowId);
    expect(result).toBeNull();
  });

  it('upserts schedule trigger via PATCH compat route', async () => {
    const body = { enabled: true, timezone: 'UTC', type: 'daily' };
    const updated = { id: flowId, triggerConfig: { kind: 'schedule', params: body } };
    const flow = { id: flowId, triggerConfig: { kind: 'schedule', params: {} } };
    const flowService = makeFlowService(flow, updated);
    const graphClient = makeGraphClient();
    const controller = new PlaybookFlowTriggerController(flowService as any, graphClient as any);

    const result = await controller.upsertScheduleTrigger(userId, flowId, body);
    expect(flowService.update).toHaveBeenCalledWith(flowId, userId, expect.objectContaining({
      triggerConfig: { kind: 'schedule', params: expect.objectContaining(body) },
    }));
    expect(result).toBe(updated);
  });

  it('upserts schedule trigger via PUT compat route', async () => {
    const body = { enabled: true, timezone: 'UTC', type: 'weekly' };
    const updated = { id: flowId, triggerConfig: { kind: 'schedule', params: body } };
    const flow = { id: flowId, triggerConfig: { kind: 'schedule', params: {} } };
    const flowService = makeFlowService(flow, updated);
    const graphClient = makeGraphClient();
    const controller = new PlaybookFlowTriggerController(flowService as any, graphClient as any);

    await controller.upsertScheduleTriggerCompat(userId, flowId, body);
    expect(flowService.update).toHaveBeenCalledWith(flowId, userId, expect.objectContaining({
      triggerConfig: { kind: 'schedule', params: expect.objectContaining(body) },
    }));
  });

  it('disables schedule trigger via DELETE compat route when kind matches', async () => {
    const updated = { id: flowId, triggerConfig: { kind: 'schedule', params: { enabled: false } } };
    const flow = { id: flowId, triggerConfig: { kind: 'schedule', params: { enabled: true, timezone: 'UTC' } } };
    const flowService = makeFlowService(flow, updated);
    const graphClient = makeGraphClient();
    const controller = new PlaybookFlowTriggerController(flowService as any, graphClient as any);

    await controller.clearScheduleTriggerCompat(userId, flowId);
    expect(flowService.update).toHaveBeenCalledWith(flowId, userId, expect.objectContaining({
      triggerConfig: expect.objectContaining({ kind: 'schedule', params: expect.objectContaining({ enabled: false }) }),
    }));
  });

  it('returns flow unchanged when deleting schedule trigger but stored kind is mail', async () => {
    const flow = { id: flowId, triggerConfig: { kind: 'mail', params: { enabled: true, mailboxAppKey: 'm365' } } };
    const flowService = makeFlowService(flow, {});
    const graphClient = makeGraphClient();
    const controller = new PlaybookFlowTriggerController(flowService as any, graphClient as any);

    const result = await controller.clearScheduleTriggerCompat(userId, flowId);
    expect(result).toBe(flow);
    expect(flowService.update).not.toHaveBeenCalled();
  });

  it('upserts mail trigger via PATCH compat route', async () => {
    const body = { enabled: true, mailboxAppKey: 'm365' };
    const updated = { id: flowId, triggerConfig: { kind: 'mail', params: body } };
    const flow = { id: flowId, triggerConfig: { kind: 'mail', params: {} } };
    const flowService = makeFlowService(flow, updated);
    const graphClient = makeGraphClient();
    const controller = new PlaybookFlowTriggerController(flowService as any, graphClient as any);

    await controller.upsertMailTrigger(userId, flowId, body);
    expect(flowService.update).toHaveBeenCalledWith(flowId, userId, expect.objectContaining({
      triggerConfig: { kind: 'mail', params: expect.objectContaining(body) },
    }));
  });

  it('upserts mail trigger via PUT compat route', async () => {
    const body = { enabled: true, mailboxAppKey: 'm365' };
    const updated = { id: flowId, triggerConfig: { kind: 'mail', params: body } };
    const flow = { id: flowId, triggerConfig: { kind: 'mail', params: {} } };
    const flowService = makeFlowService(flow, updated);
    const graphClient = makeGraphClient();
    const controller = new PlaybookFlowTriggerController(flowService as any, graphClient as any);

    await controller.upsertMailTriggerCompat(userId, flowId, body);
    expect(flowService.update).toHaveBeenCalledWith(flowId, userId, expect.objectContaining({
      triggerConfig: { kind: 'mail', params: expect.objectContaining(body) },
    }));
  });

  it('disables mail trigger via DELETE compat route when kind matches', async () => {
    const updated = { id: flowId, triggerConfig: { kind: 'mail', params: { enabled: false } } };
    const flow = { id: flowId, triggerConfig: { kind: 'mail', params: { enabled: true } } };
    const flowService = makeFlowService(flow, updated);
    const graphClient = makeGraphClient();
    const controller = new PlaybookFlowTriggerController(flowService as any, graphClient as any);

    await controller.clearMailTriggerCompat(userId, flowId);
    expect(flowService.update).toHaveBeenCalledWith(flowId, userId, expect.objectContaining({
      triggerConfig: expect.objectContaining({ kind: 'mail', params: expect.objectContaining({ enabled: false }) }),
    }));
  });

  it('returns flow unchanged when deleting mail trigger but stored kind is schedule', async () => {
    const flow = { id: flowId, triggerConfig: { kind: 'schedule', params: { enabled: true, timezone: 'UTC' } } };
    const flowService = makeFlowService(flow, {});
    const graphClient = makeGraphClient();
    const controller = new PlaybookFlowTriggerController(flowService as any, graphClient as any);

    const result = await controller.clearMailTriggerCompat(userId, flowId);
    expect(result).toBe(flow);
    expect(flowService.update).not.toHaveBeenCalled();
  });

  it('syncs mail subscription and persists result via the compat route', async () => {
    const body = { notificationUrl: 'https://example.test/webhook', autoRenewUntil: '2026-06-16T00:00:00.000Z' };
    const flow = { id: flowId, triggerConfig: { kind: 'mail', params: { mailboxAppKey: 'm365' } } };
    const updated = {
      id: flowId,
      triggerConfig: {
        kind: 'mail',
        params: {
          mailboxAppKey: 'm365',
          subscriptionId: 'sub-1',
          subscriptionClientState: flowId,
          subscriptionExpiresAt: '2026-06-16T00:00:00.000Z',
        },
      },
    };
    const flowService = makeFlowService(flow, updated);
    const graphClient = makeGraphClient();
    const controller = new PlaybookFlowTriggerController(flowService as any, graphClient as any);

    await controller.syncMailSubscription(userId, flowId, body);
    expect(graphClient.createInboxSubscription).toHaveBeenCalledWith(
      userId, 'm365', body.notificationUrl, flowId, '2026-06-16T00:00:00.000Z',
    );
    expect(flowService.update).toHaveBeenCalledWith(flowId, userId, expect.objectContaining({
      triggerConfig: expect.objectContaining({
        kind: 'mail',
        params: expect.objectContaining({
          subscriptionId: 'sub-1',
          subscriptionClientState: flowId,
          subscriptionExpiresAt: '2026-06-16T00:00:00.000Z',
        }),
      }),
    }));
  });

  it('syncs mail subscription via the compat /triggers/mail/sync-subscription route', async () => {
    const body = { notificationUrl: 'https://example.test/webhook' };
    const flow = { id: flowId, triggerConfig: { kind: 'mail', params: { mailboxAppKey: 'm365' } } };
    const updated = {
      id: flowId,
      triggerConfig: {
        kind: 'mail',
        params: { mailboxAppKey: 'm365', subscriptionId: 'sub-1', subscriptionClientState: flowId, subscriptionExpiresAt: '2026-06-16T00:00:00.000Z' },
      },
    };
    const flowService = makeFlowService(flow, updated);
    const graphClient = makeGraphClient();
    const controller = new PlaybookFlowTriggerController(flowService as any, graphClient as any);

    await controller.syncMailSubscriptionCompat(userId, flowId, body);
    expect(graphClient.createInboxSubscription).toHaveBeenCalled();
  });
});
