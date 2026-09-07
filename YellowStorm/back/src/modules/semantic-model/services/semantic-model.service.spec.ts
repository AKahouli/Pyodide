import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelService } from './semantic-model.service';

describe('SemanticModelService archived access', () => {
  const accessible = {
    id: 'model-id',
    role: 'owner',
    status: 'archived',
  };
  const repository = { findAccessible: jest.fn() };
  const ageGraph = { graphNameForModel: jest.fn((id: string) => `sem_${id}`) };
  const service = new SemanticModelService({} as never, repository as never, {} as never, {} as never, ageGraph as never);

  beforeEach(() => {
    repository.findAccessible.mockReset();
    ageGraph.graphNameForModel.mockClear();
  });

  it('allows archived models to be inspected', async () => {
    repository.findAccessible.mockResolvedValue(accessible);
    await expect(service.requireRole('user-id', 'model-id', ['owner'])).resolves.toMatchObject({ status: 'archived' });
  });

  it('rejects mutation access to archived models', async () => {
    repository.findAccessible.mockResolvedValue(accessible);
    await expect(service.requireActiveRole('user-id', 'model-id', ['owner'])).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_VERSION_IMMUTABLE,
    });
  });

  it.each(['draft', 'published'])('resolves the search schema for an accessible %s model', async (status) => {
    repository.findAccessible.mockResolvedValue({ ...accessible, status });
    await expect(service.resolveSearchSchema('user-id', 'model-id')).resolves.toBe('sem_model-id');
    expect(ageGraph.graphNameForModel).toHaveBeenCalledWith('model-id');
  });

  it('rejects archived models for semantic search', async () => {
    repository.findAccessible.mockResolvedValue(accessible);
    await expect(service.resolveSearchSchema('user-id', 'model-id')).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_NOT_FOUND,
    });
  });
});
