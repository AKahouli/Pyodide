import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { PlaybookAssistantInternalController } from './playbook-assistant-internal.controller';

describe('PlaybookAssistantInternalController', () => {
  it('reads the canonical trusted identity header on every internal endpoint', () => {
    const methods = [
      'openContext',
      'getSummary',
      'getTask',
      'getTaskDependencies',
      'validate',
      'startConstruction',
      'getConstruction',
      'streamConstruction',
      'cancelConstruction',
      'analyzeTaskOptimization',
      'startAdvisorRemediationConstruction',
    ] as const;

    for (const method of methods) {
      const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, PlaybookAssistantInternalController, method) as Record<string, { data?: string }>;

      expect(Object.values(metadata).some((parameter) => parameter.data === 'x-yellowstorm-user-id')).toBe(true);
    }
  });

  it('blocks execution when the trusted user lacks playbook.execute', async () => {
    const assistantService = { startExecution: jest.fn() };
    const controller = new PlaybookAssistantInternalController(
      {} as never,
      assistantService as never,
      { findById: jest.fn().mockResolvedValue({ roles: [] }) } as never,
      { getUserPermissions: jest.fn().mockResolvedValue(['playbook.read']) } as never,
    );

    await expect(controller.startExecution('user-1', 'request-1', 'playbook-1', {} as never))
      .rejects.toThrow('cannot perform this Playbook action');
    expect(assistantService.startExecution).not.toHaveBeenCalled();
  });

  it('blocks playbook reads when the trusted user lacks playbook.read', async () => {
    const assistantService = { searchPlaybooks: jest.fn() };
    const controller = new PlaybookAssistantInternalController(
      {} as never,
      assistantService as never,
      { findById: jest.fn().mockResolvedValue({ roles: [] }) } as never,
      { getUserPermissions: jest.fn().mockResolvedValue([]) } as never,
    );

    await expect(controller.searchPlaybooks('user-1', {} as never))
      .rejects.toThrow('cannot perform this Playbook action');
    expect(assistantService.searchPlaybooks).not.toHaveBeenCalled();
  });

  it('allows accessible playbook reads after resolving playbook.read', async () => {
    const assistantService = { searchPlaybooks: jest.fn().mockResolvedValue([{ id: 'playbook-1' }]) };
    const controller = new PlaybookAssistantInternalController(
      {} as never,
      assistantService as never,
      { findById: jest.fn().mockResolvedValue({ roles: ['reader'] }) } as never,
      { getUserPermissions: jest.fn().mockResolvedValue(['playbook.read']) } as never,
    );

    await expect(controller.searchPlaybooks('user-1', {} as never))
      .resolves.toEqual([{ id: 'playbook-1' }]);
    expect(assistantService.searchPlaybooks).toHaveBeenCalledWith('user-1', {});
  });

  it('allows execution when the trusted user has playbook.execute', async () => {
    const assistantService = { startExecution: jest.fn().mockResolvedValue({ id: 'execution-1' }) };
    const controller = new PlaybookAssistantInternalController(
      {} as never,
      assistantService as never,
      { findById: jest.fn().mockResolvedValue({ roles: [] }) } as never,
      { getUserPermissions: jest.fn().mockResolvedValue(['playbook.execute']) } as never,
    );

    await expect(controller.startExecution('user-1', 'request-1', 'playbook-1', {} as never))
      .resolves.toEqual({ id: 'execution-1' });
    expect(assistantService.startExecution).toHaveBeenCalledWith('playbook-1', 'user-1', {}, 'request-1');
  });

  it('blocks construction when the trusted user lacks playbook.update', async () => {
    const assistantService = { startConstruction: jest.fn() };
    const controller = new PlaybookAssistantInternalController(
      {} as never,
      assistantService as never,
      { findById: jest.fn().mockResolvedValue({ roles: [] }) } as never,
      { getUserPermissions: jest.fn().mockResolvedValue(['playbook.read']) } as never,
    );

    await expect(controller.startConstruction('user-1', 'playbook-1', {} as never))
      .rejects.toThrow('cannot perform this Playbook action');
    expect(assistantService.startConstruction).not.toHaveBeenCalled();
  });

  it('blocks generation when the trusted user lacks playbook.create', async () => {
    const assistantService = { startGeneration: jest.fn() };
    const controller = new PlaybookAssistantInternalController(
      {} as never,
      assistantService as never,
      { findById: jest.fn().mockResolvedValue({ roles: [] }) } as never,
      { getUserPermissions: jest.fn().mockResolvedValue(['playbook.read']) } as never,
    );
    const headers = {
      'x-yellowstorm-user-id': 'user-1',
      'x-yellowstorm-agent-id': 'agent-1',
      'x-yellowstorm-conversation-id': 'conversation-1',
      'x-correlation-id': 'correlation-1',
    };

    await expect(controller.startGeneration(headers, 'request-1', {} as never))
      .rejects.toThrow('cannot perform this Playbook action');
    expect(assistantService.startGeneration).not.toHaveBeenCalled();
  });

  it('starts current-turn generation only after resolving playbook.create', async () => {
    const assistantService = { startCurrentTurnGeneration: jest.fn().mockResolvedValue({ playbookId: 'playbook-1' }) };
    const controller = new PlaybookAssistantInternalController(
      {} as never,
      assistantService as never,
      { findById: jest.fn().mockResolvedValue({ roles: ['creator'] }) } as never,
      { getUserPermissions: jest.fn().mockResolvedValue(['playbook.create']) } as never,
    );
    const headers = {
      'x-yellowstorm-tenant-id': 'default',
      'x-yellowstorm-user-id': 'user-1',
      'x-yellowstorm-agent-id': 'agent-1',
      'x-yellowstorm-conversation-id': 'conversation-1',
      'x-correlation-id': 'ai-message-1',
    };

    const dto = {
      name: 'Lead generation',
      continuationId: 'continuation-1',
      answers: [{ questionId: 'source', resource: { kind: 'workspace' as const, id: 'workspace-1' } }],
      skip: true,
    };
    await expect(controller.startCurrentTurnGeneration(headers, dto))
      .resolves.toEqual({ playbookId: 'playbook-1' });
    expect(assistantService.startCurrentTurnGeneration).toHaveBeenCalledWith({
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1',
    }, dto);
  });

  it('starts current-turn modification only after resolving playbook.update', async () => {
    const assistantService = { runCurrentTurnModification: jest.fn().mockResolvedValue({ status: 'ready' }) };
    const controller = new PlaybookAssistantInternalController(
      {} as never,
      assistantService as never,
      { findById: jest.fn().mockResolvedValue({ roles: ['creator'] }) } as never,
      { getUserPermissions: jest.fn().mockResolvedValue(['playbook.update']) } as never,
    );
    const headers = {
      'x-yellowstorm-user-id': 'user-1',
      'x-yellowstorm-agent-id': 'agent-1',
      'x-yellowstorm-conversation-id': 'conversation-1',
      'x-correlation-id': 'ai-message-1',
    };

    await expect(controller.runCurrentTurnModification(headers, 'playbook-1', {}))
      .resolves.toEqual({ status: 'ready' });
    expect(assistantService.runCurrentTurnModification).toHaveBeenCalledWith('playbook-1', {
      ownerId: 'user-1', agentId: 'agent-1',
      conversationId: 'conversation-1', correlationId: 'ai-message-1',
    }, {});
  });

  it('blocks current-turn modification when the trusted user lacks playbook.update', async () => {
    const assistantService = { runCurrentTurnModification: jest.fn() };
    const controller = new PlaybookAssistantInternalController(
      {} as never,
      assistantService as never,
      { findById: jest.fn().mockResolvedValue({ roles: [] }) } as never,
      { getUserPermissions: jest.fn().mockResolvedValue(['playbook.read']) } as never,
    );
    const headers = {
      'x-yellowstorm-user-id': 'user-1',
      'x-yellowstorm-agent-id': 'agent-1',
      'x-yellowstorm-conversation-id': 'conversation-1',
      'x-correlation-id': 'ai-message-1',
    };

    await expect(controller.runCurrentTurnModification(headers, 'playbook-1', {}))
      .rejects.toThrow('cannot perform this Playbook action');
    expect(assistantService.runCurrentTurnModification).not.toHaveBeenCalled();
  });
});
