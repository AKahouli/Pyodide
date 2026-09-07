import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelService } from './semantic-model.service';

describe('SemanticModelService archived access', () => {
  const accessible = {
    id: 'model-id',
    role: 'owner',
    status: 'archived',
  };
  const repository = { findAccessible: jest.fn() };
  const service = new SemanticModelService({} as never, repository as never, {} as never, {} as never, {} as never);

  beforeEach(() => repository.findAccessible.mockReset());

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
});
