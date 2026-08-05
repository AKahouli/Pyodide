import { AgentRoleEmbeddingService } from './agent-role-embedding.service';

const flush = () => new Promise((r) => setTimeout(r, 10));
function loggerStub() {
  return { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } as any;
}

describe('AgentRoleEmbeddingService', () => {
  it('does nothing for a non-humain agent', async () => {
    const embeddingService = { embed: jest.fn() };
    const agentRepository = { setRoleEmbedding: jest.fn() };
    const svc = new AgentRoleEmbeddingService(embeddingService as any, agentRepository as any, loggerStub());

    svc.reindexHumainRole('a1', 'simple', 'Bob', 'Do things');
    await flush();

    expect(embeddingService.embed).not.toHaveBeenCalled();
    expect(agentRepository.setRoleEmbedding).not.toHaveBeenCalled();
  });

  it('embeds `name. role` and stores the vector for a humain agent', async () => {
    const embeddingService = { embed: jest.fn().mockResolvedValue([0.1, 0.2]) };
    const agentRepository = { setRoleEmbedding: jest.fn().mockResolvedValue(undefined) };
    const svc = new AgentRoleEmbeddingService(embeddingService as any, agentRepository as any, loggerStub());

    svc.reindexHumainRole('a1', 'humain', 'Alice', 'Support agent');
    await flush();

    expect(embeddingService.embed).toHaveBeenCalledWith('Alice. Support agent');
    expect(agentRepository.setRoleEmbedding).toHaveBeenCalledWith('a1', [0.1, 0.2]);
  });

  it('skips storage when embedding is unavailable (returns null)', async () => {
    const embeddingService = { embed: jest.fn().mockResolvedValue(null) };
    const agentRepository = { setRoleEmbedding: jest.fn() };
    const svc = new AgentRoleEmbeddingService(embeddingService as any, agentRepository as any, loggerStub());

    svc.reindexHumainRole('a1', 'humain', 'Alice', 'Support agent');
    await flush();

    expect(agentRepository.setRoleEmbedding).not.toHaveBeenCalled();
  });

  it('never throws when embedding rejects', async () => {
    const logger = loggerStub();
    const embeddingService = { embed: jest.fn().mockRejectedValue(new Error('boom')) };
    const agentRepository = { setRoleEmbedding: jest.fn() };
    const svc = new AgentRoleEmbeddingService(embeddingService as any, agentRepository as any, logger);

    expect(() => svc.reindexHumainRole('a1', 'humain', 'Alice', 'Support agent')).not.toThrow();
    await flush();
    expect(logger.warn).toHaveBeenCalled();
  });
});
