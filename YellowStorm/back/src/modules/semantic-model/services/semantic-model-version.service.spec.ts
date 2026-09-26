import { ConflictException, ServiceUnavailableException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelVersionService } from './semantic-model-version.service';

describe('SemanticModelVersionService publish', () => {
  const graph = { nodes: [], relations: [], records: [], recordRelations: [] };
  const client = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FOR UPDATE')) return { rows: [{ version_number: 1, revision: 3 }] };
      if (sql.includes('INSERT INTO semantic_model.versions')) return { rows: [{ id: 'draft-2' }] };
      return { rows: [] };
    }),
  };
  const database = { transaction: jest.fn(async (work: (c: typeof client) => unknown) => work(client)) };
  const graphRepository = { getGraph: jest.fn(async () => graph), apply: jest.fn() };
  const models = {
    requireActiveRole: jest.fn(async () => ({ id: 'm1', currentDraftVersionId: 'v1' })),
    advanceRevision: jest.fn(async () => 8),
    audit: jest.fn(),
  };
  const validation = { validate: jest.fn(() => []) };
  const runtime = { publishModelData: jest.fn() };
  const service = new SemanticModelVersionService(
    database as never, graphRepository as never, models as never, validation as never, runtime as never);

  beforeEach(() => runtime.publishModelData.mockReset());

  it('publishes the records built from the published version', async () => {
    runtime.publishModelData.mockResolvedValue({ reused: false });
    await expect(service.publish('u1', 'm1', 7, 3)).resolves.toMatchObject({
      publishedVersionId: 'v1', draftVersionId: 'draft-2', data: { published: true },
    });
    expect(runtime.publishModelData).toHaveBeenCalledWith('m1', { actorUserId: 'u1', modelVersionId: 'v1' });
  });

  it('still publishes the structure when records are outdated or the runtime is down', async () => {
    runtime.publishModelData.mockRejectedValueOnce(new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT, 'draft_data_outdated'));
    await expect(service.publish('u1', 'm1', 7, 3)).resolves.toMatchObject({ data: { published: false, reason: 'draft_data_outdated' } });
    runtime.publishModelData.mockRejectedValueOnce(new ServiceUnavailableException(ErrorCode.SEMANTIC_MODEL_UNAVAILABLE));
    await expect(service.publish('u1', 'm1', 7, 3)).resolves.toMatchObject({ data: { published: false, reason: 'runtime_unavailable' } });
  });
});
