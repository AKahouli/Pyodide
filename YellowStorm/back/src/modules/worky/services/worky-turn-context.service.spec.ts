import { WorkyTurnContextService } from './worky-turn-context.service';

describe('WorkyTurnContextService', () => {
  let service: WorkyTurnContextService;
  let models: { getDefaultModel: jest.Mock; getModelIdentifier: jest.Mock };
  let connectorService: { findBySlug: jest.Mock; findByIdsForGrpc: jest.Mock };
  let agentService: { findDefaultByAgentType: jest.Mock; buildGrpcAgentsForPlaybook: jest.Mock };
  let agentTypeService: { findBySlug: jest.Mock };
  let mailSubscriptions: { ensureForUser: jest.Mock };
  let logger: { setContext: jest.Mock; log: jest.Mock; warn: jest.Mock; error: jest.Mock; debug: jest.Mock };

  beforeEach(() => {
    models = {
      getDefaultModel: jest.fn().mockResolvedValue({ id: 'default-model', litellmModel: 'openai/gpt-4o-mini' }),
      getModelIdentifier: jest.fn((m: { litellmModel?: string; id?: string } | null) => m?.litellmModel || m?.id || ''),
    };
    connectorService = {
      findBySlug: jest.fn().mockImplementation((slug: string) => {
        if (slug === 'code-interpreter') return Promise.resolve({ id: 'c1', slug: 'code-interpreter' });
        if (slug === 'linkup') return Promise.resolve({ id: 'c2', slug: 'linkup' });
        return Promise.resolve(null);
      }),
      findByIdsForGrpc: jest
        .fn()
        .mockResolvedValue([{ connector_id: 'c1' }, { connector_id: 'c2' }]),
    };
    agentTypeService = {
      findBySlug: jest.fn().mockImplementation((slug: string) => {
        if (slug === 'worky-planner') return Promise.resolve({ id: 'type-planner' });
        if (slug === 'worky-executer') return Promise.resolve({ id: 'type-executer' });
        return Promise.resolve(null);
      }),
    };
    agentService = {
      findDefaultByAgentType: jest.fn().mockImplementation((typeId: string) => {
        if (typeId === 'type-planner') return Promise.resolve({ id: 'agent-planner' });
        if (typeId === 'type-executer') return Promise.resolve({ id: 'agent-executer' });
        return Promise.resolve(null);
      }),
      buildGrpcAgentsForPlaybook: jest
        .fn()
        .mockImplementation((_userId: string, ids: string[]) =>
          Promise.resolve(ids.map((id) => ({ id }))),
        ),
    };
    mailSubscriptions = { ensureForUser: jest.fn().mockResolvedValue(undefined) };
    logger = {
      setContext: jest.fn(), log: jest.fn(), warn: jest.fn(),
      error: jest.fn(), debug: jest.fn(),
    };
    service = new WorkyTurnContextService(
      models as any,
      connectorService as any,
      agentService as any,
      agentTypeService as any,
      mailSubscriptions as any,
      logger as any,
    );
  });

  describe('resolveConnectors', () => {
    it('resolves every connector worky needs by slug', async () => {
      const connectors = await service.resolveConnectors('user-1');

      // microsoft365 was split into outlook (mail/calendar), sharepoint (files)
      // and teams; all three have to be asked for or the plan silently loses
      // whole tool families.
      for (const slug of ['code-interpreter', 'linkup', 'outlook', 'sharepoint', 'teams']) {
        expect(connectorService.findBySlug).toHaveBeenCalledWith(slug);
      }
      expect(connectorService.findByIdsForGrpc).toHaveBeenCalledWith(['c1', 'c2'], 'user-1');
      expect(connectors).toEqual([{ connector_id: 'c1' }, { connector_id: 'c2' }]);
    });

    it('returns no connectors and swallows the error when resolution fails', async () => {
      connectorService.findBySlug.mockRejectedValue(new Error('connector svc down'));

      const connectors = await service.resolveConnectors('user-1');

      expect(logger.warn).toHaveBeenCalled();
      expect(connectors).toEqual([]);
    });

    it('propagates connector lookup errors in strict mode', async () => {
      connectorService.findBySlug.mockRejectedValue(new Error('connector svc down'));

      await expect(service.resolveConnectorsStrict('user-1')).rejects.toThrow(
        'connector svc down',
      );
    });

    it('keeps the mailbox subscription alive whenever outlook resolves', async () => {
      connectorService.findBySlug.mockImplementation((slug: string) =>
        slug === 'outlook' ? Promise.resolve({ id: 'c3', slug: 'outlook' }) : Promise.resolve(null),
      );

      await service.resolveConnectors('user-1');

      expect(mailSubscriptions.ensureForUser).toHaveBeenCalledWith('user-1');
    });

    it('does not arm the mail webhook off sharepoint or teams', async () => {
      // Both are Graph connectors too, so "a Microsoft connector resolved" is
      // not the condition -- arming off either would subscribe a mailbox whose
      // send_email tool the plan never had.
      connectorService.findBySlug.mockImplementation((slug: string) =>
        slug === 'sharepoint' || slug === 'teams'
          ? Promise.resolve({ id: 'c4', slug })
          : Promise.resolve(null),
      );

      await service.resolveConnectors('user-1');

      expect(mailSubscriptions.ensureForUser).not.toHaveBeenCalled();
    });

    it('does not touch the mail subscription when outlook is not bound', async () => {
      await service.resolveConnectors('user-1'); // only code-interpreter/linkup resolve, per the default mock
      expect(mailSubscriptions.ensureForUser).not.toHaveBeenCalled();
    });
  });

  describe('resolveManagerModel', () => {
    it('uses the given model when one is provided', async () => {
      const model = await service.resolveManagerModel('anthropic/claude-3-5-sonnet');
      expect(model).toBe('anthropic/claude-3-5-sonnet');
      expect(models.getDefaultModel).not.toHaveBeenCalled();
    });

    it('falls back to the admin default when none is given', async () => {
      const model = await service.resolveManagerModel(null);
      expect(models.getDefaultModel).toHaveBeenCalledTimes(1);
      expect(model).toBe('openai/gpt-4o-mini');
    });
  });

  describe('resolveWorkyAgents', () => {
    it('resolves the default planner & executer agents by type and builds them', async () => {
      const agents = await service.resolveWorkyAgents('user-1');

      expect(agentTypeService.findBySlug).toHaveBeenCalledWith('worky-planner');
      expect(agentTypeService.findBySlug).toHaveBeenCalledWith('worky-executer');
      expect(agentService.findDefaultByAgentType).toHaveBeenCalledWith('type-planner');
      expect(agentService.findDefaultByAgentType).toHaveBeenCalledWith('type-executer');
      expect(agentService.buildGrpcAgentsForPlaybook).toHaveBeenCalledWith('user-1', [
        'agent-planner',
        'agent-executer',
      ]);
      expect(agents).toEqual([{ id: 'agent-planner' }, { id: 'agent-executer' }]);
    });

    it('sends none (does not throw) when an agent type is missing', async () => {
      agentTypeService.findBySlug.mockResolvedValue(null);

      const agents = await service.resolveWorkyAgents('user-1');

      expect(agents).toEqual([]);
      expect(agentService.buildGrpcAgentsForPlaybook).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalled();
    });

    it('builds whatever resolves when only one default agent exists', async () => {
      agentService.findDefaultByAgentType.mockImplementation((typeId: string) =>
        typeId === 'type-planner' ? Promise.resolve({ id: 'agent-planner' }) : Promise.resolve(null),
      );

      const agents = await service.resolveWorkyAgents('user-1');

      expect(agentService.buildGrpcAgentsForPlaybook).toHaveBeenCalledWith('user-1', ['agent-planner']);
      expect(agents).toEqual([{ id: 'agent-planner' }]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('swallows a resolution error and sends none', async () => {
      agentService.buildGrpcAgentsForPlaybook.mockRejectedValue(new Error('agent svc down'));

      const agents = await service.resolveWorkyAgents('user-1');

      expect(agents).toEqual([]);
      expect(logger.warn).toHaveBeenCalled();
    });

    it('propagates agent build errors in strict mode', async () => {
      agentService.buildGrpcAgentsForPlaybook.mockRejectedValue(new Error('agent svc down'));

      await expect(service.resolveWorkyAgentsStrict('user-1')).rejects.toThrow(
        'agent svc down',
      );
    });
  });
});
