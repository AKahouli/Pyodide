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

describe('SemanticModelVersionService compare', () => {
  const field = (key: string, label: string, extra: Record<string, unknown> = {}) => ({ key, label, type: 'text', required: false, ...extra });
  const before = {
    nodes: [
      { id: 'n1', key: 'customer', label: 'Customer', attributes: [field('name', 'Name'), field('vat', 'VAT'), field('city', 'City')] },
      { id: 'n2', key: 'contract', label: 'Contract', attributes: [] },
      { id: 'n3', key: 'old', label: 'Old thing', attributes: [] },
    ],
    relations: [
      { id: 'r1', key: 'holds', label: 'holds', sourceNodeTypeId: 'n1', targetNodeTypeId: 'n2', cardinality: 'one_to_many' },
      { id: 'r2', key: 'gone', label: 'gone', sourceNodeTypeId: 'n1', targetNodeTypeId: 'n3', cardinality: 'one_to_one' },
    ],
    records: [], recordRelations: [],
  };
  const after = {
    nodes: [
      { id: 'n1', key: 'customer', label: 'Client', attributes: [field('name', 'Legal name'), field('vat', 'VAT', { type: 'number', required: true }), field('email', 'Email')] },
      { id: 'n2', key: 'contract', label: 'Contract', attributes: [] },
      { id: 'n4', key: 'invoice', label: 'Invoice', attributes: [] },
    ],
    relations: [
      { id: 'r1', key: 'holds', label: 'signs', sourceNodeTypeId: 'n1', targetNodeTypeId: 'n2', cardinality: 'many_to_many' },
      { id: 'r3', key: 'bills', label: 'bills', sourceNodeTypeId: 'n4', targetNodeTypeId: 'n1', cardinality: 'many_to_one' },
    ],
    records: [], recordRelations: [],
  };
  const database = { query: jest.fn(async () => ({ rowCount: 2, rows: [{ id: 'left', revision: 1 }, { id: 'right', revision: 2 }] })) };
  const graphRepository = { getGraph: jest.fn(async (_m: string, id: string) => (id === 'left' ? before : after)) };
  const models = { requireRole: jest.fn(async () => ({ id: 'm1' })) };
  const runtime = { getDataSummary: jest.fn() };
  const service = new SemanticModelVersionService(
    database as never, graphRepository as never, models as never, {} as never, runtime as never);

  it('describes renames by id, field and cardinality changes in business terms', async () => {
    runtime.getDataSummary.mockResolvedValueOnce({
      modelId: 'm1', draft: { modelVersionId: 'right', records: 120, links: 3 }, production: { modelVersionId: 'left', records: 100, links: 2 },
    });
    const result = await service.compare('u1', 'm1', 'left', 'right');
    expect(result.changes).toEqual(expect.arrayContaining([
      { kind: 'concept_renamed', from: 'Customer', to: 'Client' },
      { kind: 'concept_added', concept: 'Invoice' },
      { kind: 'concept_removed', concept: 'Old thing' },
      { kind: 'field_renamed', concept: 'Client', from: 'Name', to: 'Legal name' },
      { kind: 'field_type_changed', concept: 'Client', field: 'VAT', from: 'text', to: 'number' },
      { kind: 'field_required_changed', concept: 'Client', field: 'VAT', required: true },
      { kind: 'field_added', concept: 'Client', field: 'Email' },
      { kind: 'field_removed', concept: 'Client', field: 'City' },
      { kind: 'relation_renamed', from: 'holds', to: 'signs', source: 'Client', target: 'Contract' },
      { kind: 'relation_cardinality_changed', relation: 'signs', source: 'Client', target: 'Contract', from: 'one_to_many', to: 'many_to_many' },
      { kind: 'relation_added', relation: 'bills', source: 'Invoice', target: 'Client' },
      { kind: 'relation_removed', relation: 'gone', source: 'Client', target: 'Old thing' },
    ]));
    expect(result.changes).not.toContainEqual(expect.objectContaining({ kind: 'concept_added', concept: 'Client' }));
    expect(result.records).toEqual({ before: 100, after: 120, change: 20 });
  });

  it('leaves record counts unknown when the runtime cannot say', async () => {
    runtime.getDataSummary.mockRejectedValueOnce(new Error('down'));
    const result = await service.compare('u1', 'm1', 'left', 'right');
    expect(result.records).toEqual({ before: null, after: null, change: null });
  });
});
