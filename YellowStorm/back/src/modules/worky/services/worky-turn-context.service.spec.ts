import { WorkyTurnContextService } from './worky-turn-context.service';

describe('WorkyTurnContextService', () => {
  let service: WorkyTurnContextService;
  let models: { getDefaultModel: jest.Mock; getModelIdentifier: jest.Mock };
  let connectorService: { findBySlug: jest.Mock; findByIdsForGrpc: jest.Mock };
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
    mailSubscriptions = { ensureForUser: jest.fn().mockResolvedValue(undefined) };
    logger = {
      setContext: jest.fn(), log: jest.fn(), warn: jest.fn(),
      error: jest.fn(), debug: jest.fn(),
    };
    service = new WorkyTurnContextService(
      models as any, connectorService as any, mailSubscriptions as any, logger as any,
    );
  });

  describe('resolveConnectors', () => {
    it('resolves code-interpreter & linkup connectors by slug', async () => {
      const connectors = await service.resolveConnectors('user-1');

      expect(connectorService.findBySlug).toHaveBeenCalledWith('code-interpreter');
      expect(connectorService.findBySlug).toHaveBeenCalledWith('linkup');
      expect(connectorService.findByIdsForGrpc).toHaveBeenCalledWith(['c1', 'c2'], 'user-1');
      expect(connectors).toEqual([{ connector_id: 'c1' }, { connector_id: 'c2' }]);
    });

    it('returns no connectors and swallows the error when resolution fails', async () => {
      connectorService.findBySlug.mockRejectedValue(new Error('connector svc down'));

      const connectors = await service.resolveConnectors('user-1');

      expect(logger.warn).toHaveBeenCalled();
      expect(connectors).toEqual([]);
    });

    it('keeps the mailbox subscription alive whenever microsoft365 resolves', async () => {
      connectorService.findBySlug.mockImplementation((slug: string) =>
        slug === 'microsoft365' ? Promise.resolve({ id: 'c3', slug: 'microsoft365' }) : Promise.resolve(null),
      );

      await service.resolveConnectors('user-1');

      expect(mailSubscriptions.ensureForUser).toHaveBeenCalledWith('user-1');
    });

    it('does not touch the mail subscription when microsoft365 is not bound', async () => {
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
});
