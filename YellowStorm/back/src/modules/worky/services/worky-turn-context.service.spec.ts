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
        if (typeId === 'type-planner') return Promise.resolve({ id: 'agent-planner', connectors: ['c1'] });
        if (typeId === 'type-executer') return Promise.resolve({ id: 'agent-executer', connectors: ['c2'] });
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
    it('resolves the union of connectors linked to the planner and executer agents', async () => {
      const connectors = await service.resolveConnectors('user-1');

      // Worky's toolset is whatever the admin linked to its agents (agent_connectors),
      // not a hardcoded slug list: planner has c1, executer has c2 → their union.
      expect(agentService.findDefaultByAgentType).toHaveBeenCalledWith('type-planner');
      expect(agentService.findDefaultByAgentType).toHaveBeenCalledWith('type-executer');
      expect(connectorService.findByIdsForGrpc).toHaveBeenCalledWith(['c1', 'c2'], 'user-1');
      expect(connectors).toEqual([{ connector_id: 'c1' }, { connector_id: 'c2' }]);
    });

    it('de-duplicates a connector linked to both agents', async () => {
      agentService.findDefaultByAgentType.mockImplementation((typeId: string) =>
        typeId === 'type-planner'
          ? Promise.resolve({ id: 'agent-planner', connectors: ['c1', 'c2'] })
          : Promise.resolve({ id: 'agent-executer', connectors: ['c2'] }),
      );

      await service.resolveConnectors('user-1');

      expect(connectorService.findByIdsForGrpc).toHaveBeenCalledWith(['c1', 'c2'], 'user-1');
    });

    it('returns [] and does not call the connector service when nothing is linked', async () => {
      agentService.findDefaultByAgentType.mockImplementation((typeId: string) =>
        Promise.resolve({ id: typeId === 'type-planner' ? 'agent-planner' : 'agent-executer', connectors: [] }),
      );

      const connectors = await service.resolveConnectors('user-1');

      expect(connectors).toEqual([]);
      expect(connectorService.findByIdsForGrpc).not.toHaveBeenCalled();
    });

    it('returns [] and swallows the error when resolution fails', async () => {
      agentService.findDefaultByAgentType.mockRejectedValue(new Error('agent svc down'));

      const connectors = await service.resolveConnectors('user-1');

      expect(logger.warn).toHaveBeenCalled();
      expect(connectors).toEqual([]);
    });

    it('arms the mail webhook when the outlook connector is one of the linked ones', async () => {
      agentService.findDefaultByAgentType.mockImplementation((typeId: string) =>
        typeId === 'type-executer'
          ? Promise.resolve({ id: 'agent-executer', connectors: ['mail-id'] })
          : Promise.resolve({ id: 'agent-planner', connectors: [] }),
      );
      connectorService.findBySlug.mockImplementation((slug: string) =>
        slug === 'outlook' ? Promise.resolve({ id: 'mail-id', slug: 'outlook' }) : Promise.resolve(null),
      );

      await service.resolveConnectors('user-1');

      expect(mailSubscriptions.ensureForUser).toHaveBeenCalledWith('user-1');
    });

    it('does not arm the mail webhook when outlook is not among the linked connectors', async () => {
      // Agents link c1/c2; the outlook connector has a different id, so its
      // send_email tool is not in this turn — no mailbox subscription.
      connectorService.findBySlug.mockImplementation((slug: string) =>
        slug === 'outlook' ? Promise.resolve({ id: 'mail-id', slug: 'outlook' }) : Promise.resolve(null),
      );

      await service.resolveConnectors('user-1');

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
  });
});
