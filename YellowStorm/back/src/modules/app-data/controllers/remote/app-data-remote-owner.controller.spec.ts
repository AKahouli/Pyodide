import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AppDataRemoteOwnerController } from './app-data-remote-owner.controller';
import { AppDataClientService } from '../../services/app-data-client.service';
import { AppDataDeploymentService } from '../../services/app-data-deployment.service';

describe('AppDataRemoteOwnerController', () => {
  const buildController = (overrides: {
    enabled?: boolean;
    aiSessionId?: string | null;
  } = {}) => {
    const { enabled = true, aiSessionId = 'ws-1' } = overrides;
    const config = {
      get: jest.fn((key: string) => (key === 'appData.enabled' ? enabled : undefined)),
    };
    const client = {
      ensureApp: jest.fn().mockResolvedValue({
        id: 'app-1',
        workspaceId: 'ws-1',
        name: 'test',
        ownerUserId: 'owner-obj-id',
      }),
      issueTicket: jest.fn().mockResolvedValue({ ticket: 'ticket-1' }),
    };
    const sessions = {
      findById: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(
          aiSessionId ? { aiSessionId } : null,
        ),
      }),
    };
    const deployment = {
      getRuntimeEnvForWorkspace: jest.fn().mockResolvedValue({
        publicUrl: 'https://preview.example.test',
      }),
    };
    const controller = new AppDataRemoteOwnerController(
      config as unknown as ConfigService,
      client as unknown as AppDataClientService,
      sessions as never,
      deployment as unknown as AppDataDeploymentService,
    );
    return { controller, client, deployment, sessions };
  };

  const resolvedSession = (ownerId: string, actorUserId: string) =>
    ({ conversationV2Session: { ownerId, actorUserId } }) as unknown as Request;

  it('issues an owner-scoped ticket when the caller is the session owner', async () => {
    const { controller, client, deployment } = buildController();
    const result = await controller.ticket('s-1', resolvedSession('owner-obj-id', 'owner-obj-id'));
    expect(client.ensureApp).toHaveBeenCalledWith('ws-1', undefined, 'owner-obj-id');
    expect(client.issueTicket).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'owner-obj-id',
      appDataId: 'app-1',
      env: 'dev',
    });
    expect(deployment.getRuntimeEnvForWorkspace).toHaveBeenCalledWith('ws-1', 'dev');
    expect(result).toMatchObject({ ticket: 'ticket-1', appDataId: 'app-1' });
  });

  it('attributes the app row to the owner but issues a shared-user ticket for a Share-by-Email recipient', async () => {
    const { controller, client } = buildController();
    const result = await controller.ticket('s-1', resolvedSession('owner-obj-id', 'shared-uuid'));
    expect(client.ensureApp).toHaveBeenCalledWith('ws-1', undefined, 'owner-obj-id');
    expect(client.issueTicket).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      userId: 'shared-uuid',
      appDataId: 'app-1',
      env: 'dev',
    });
    expect(result.ticket).toBe('ticket-1');
  });

  it('rejects with ServiceUnavailableException when the guard did not resolve a session', async () => {
    const { controller, client } = buildController();
    await expect(controller.ticket('s-1', {} as Request)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(client.ensureApp).not.toHaveBeenCalled();
    expect(client.issueTicket).not.toHaveBeenCalled();
  });

  it('rejects when App Data is disabled without touching the client or deployment', async () => {
    const { controller, client, deployment } = buildController({ enabled: false });
    await expect(
      controller.ticket('s-1', resolvedSession('owner-obj-id', 'owner-obj-id')),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(client.ensureApp).not.toHaveBeenCalled();
    expect(client.issueTicket).not.toHaveBeenCalled();
    expect(deployment.getRuntimeEnvForWorkspace).not.toHaveBeenCalled();
  });
});