import type { SemanticModelDatabaseService } from '../infrastructure/semantic-model-database.service';
import { SemanticAgeGraphRepository } from './semantic-age-graph.repository';

describe('SemanticAgeGraphRepository.dropGraph', () => {
  const buildRepository = (error: Error) => {
    const client = {
      query: jest.fn()
        .mockResolvedValueOnce({})
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(error),
      release: jest.fn(),
    };
    const database = { acquireAgeClient: jest.fn().mockResolvedValue(client) } as unknown as SemanticModelDatabaseService;
    return { repository: new SemanticAgeGraphRepository(database), client };
  };

  it('treats an absent graph as an idempotent strict drop', async () => {
    const { repository, client } = buildRepository(new Error('graph "sem_model" does not exist'));
    await expect(repository.dropGraph('model', true)).resolves.toBeUndefined();
    expect(client.release).toHaveBeenCalled();
  });

  it('keeps other strict drop failures fatal', async () => {
    const { repository, client } = buildRepository(new Error('permission denied'));
    await expect(repository.dropGraph('model', true)).rejects.toThrow('permission denied');
    expect(client.release).toHaveBeenCalled();
  });

  it('tolerates a denied LOAD for least-privilege roles when the drop succeeds', async () => {
    const client = {
      query: jest.fn()
        .mockRejectedValueOnce(new Error('permission denied for language c'))
        .mockResolvedValue({}),
      release: jest.fn(),
    };
    const database = { acquireAgeClient: jest.fn().mockResolvedValue(client) } as unknown as SemanticModelDatabaseService;
    const repository = new SemanticAgeGraphRepository(database);
    await expect(repository.dropGraph('model', true)).resolves.toBeUndefined();
    expect(client.release).toHaveBeenCalled();
  });
});
