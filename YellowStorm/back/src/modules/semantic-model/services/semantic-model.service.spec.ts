import { ConflictException, NotFoundException } from '@modules/exceptions';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';
import { SemanticModelService, remapCloneIds } from './semantic-model.service';

describe('SemanticModelService archived access', () => {
  const accessible = {
    id: 'model-id',
    role: 'owner',
    status: 'archived',
  };
  const repository = { findAccessible: jest.fn() };
  const runtime = { getPublishedBinding: jest.fn() };
  const service = new SemanticModelService({} as never, repository as never, {} as never, {} as never, {} as never, runtime as never);

  beforeEach(() => {
    repository.findAccessible.mockReset();
    runtime.getPublishedBinding.mockReset();
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

  it('resolves a published model for chat to its id and name', async () => {
    repository.findAccessible.mockResolvedValue({ ...accessible, name: 'Contracts', status: 'published' });
    runtime.getPublishedBinding.mockResolvedValue({ projectionRef: 'age:v1:pop_dr_1' });
    await expect(service.resolveChatModel('user-id', 'model-id')).resolves.toEqual({ id: 'model-id', name: 'Contracts' });
    expect(runtime.getPublishedBinding).toHaveBeenCalledWith('model-id', 'user-id');
  });

  it('keeps unpublished models out of chat', async () => {
    repository.findAccessible.mockResolvedValue({ ...accessible, status: 'draft' });
    runtime.getPublishedBinding.mockRejectedValue(new NotFoundException(ErrorCode.SEMANTIC_MODEL_NOT_FOUND));
    await expect(service.resolveChatModel('user-id', 'model-id')).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_UNAVAILABLE,
    });
  });

  it('rejects archived models for chat', async () => {
    repository.findAccessible.mockResolvedValue(accessible);
    await expect(service.resolveChatModel('user-id', 'model-id')).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_NOT_FOUND,
    });
    expect(runtime.getPublishedBinding).not.toHaveBeenCalled();
  });

  it('rejects models the user cannot access in chat', async () => {
    repository.findAccessible.mockResolvedValue(null);
    await expect(service.resolveChatModel('user-id', 'model-id')).rejects.toMatchObject({
      code: ErrorCode.SEMANTIC_MODEL_NOT_FOUND,
    });
  });

  it('propagates runtime failures other than a missing published binding', async () => {
    repository.findAccessible.mockResolvedValue({ ...accessible, status: 'published' });
    runtime.getPublishedBinding.mockRejectedValue(new Error('runtime down'));
    await expect(service.resolveChatModel('user-id', 'model-id')).rejects.toThrow('runtime down');
  });
});

describe('SemanticModelService clone', () => {
  const NODE_A = '0a000000-0000-4000-8000-00000000000a';
  const NODE_B = '0b000000-0000-4000-8000-00000000000b';
  const RELATION = '0c000000-0000-4000-8000-00000000000c';
  const MAPPING = '0d000000-0000-4000-8000-00000000000d';
  const OTHER_MAPPING = '0e000000-0000-4000-8000-00000000000e';
  const RECORD_A = '0f000000-0000-4000-8000-00000000000f';
  const SOURCE_ID = '10000000-0000-4000-8000-000000000001';
  const SOURCE_VERSION = '10000000-0000-4000-8000-000000000002';

  const sourceGraph = () => ({
    modelId: SOURCE_ID, versionId: SOURCE_VERSION, revision: 4,
    nodes: [
      { id: NODE_A, key: 'a', label: 'A', description: '', category: 'business_object', recordPolicy: 'optional', systemKey: null, aliases: ['alpha'], attributes: [{ key: 'ref', type: 'text', description: `see ${NODE_B}` }], position: { x: 0, y: 0 } },
      { id: NODE_B, key: 'b', label: 'B', description: '', category: 'business_object', recordPolicy: 'optional', systemKey: null, aliases: [], attributes: [], position: { x: 100, y: 0 } },
    ],
    relations: [{ id: RELATION, key: 'ab', label: 'links', inverseLabel: '', description: '', sourceNodeTypeId: NODE_A, targetNodeTypeId: NODE_B, cardinality: 'many_to_many', traversable: true, filterable: true, attributes: [] }],
    records: [
      { id: RECORD_A, nodeTypeId: NODE_A, label: 'A1', values: { _entity_key: RECORD_A }, status: 'active', position: { x: 0, y: 0 } },
      { id: 'record-b', nodeTypeId: NODE_B, label: 'B1', values: {}, status: 'active', position: { x: 100, y: 0 } },
    ],
    recordRelations: [{ id: 'record-relation', relationTypeId: RELATION, sourceRecordId: RECORD_A, targetRecordId: 'record-b', values: {} }],
  });

  /** A client answering the source reads by table and recording every insert. */
  function sourceClient() {
    const inserts: { sql: string; params: unknown[] }[] = [];
    const reads: Record<string, unknown[]> = {
      'semantic_model.identity_rules': [{ conceptId: NODE_A, fields: ['ref'] }],
      'semantic_model.canvas_positions': [
        { elementId: `typed:${NODE_A}`, x: 1, y: 2 },
        { elementId: 'source:ws:doc:sheet', x: 3, y: 4 },
      ],
      'semantic_model.workspace_links': [{ workspaceId: 'workspace-1', role: 'origin', enabled: true }],
      'semantic_model.knowledge_bindings': [{ targetKind: 'node_type', targetId: NODE_A, resourceKind: 'workspace', workspaceId: 'workspace-1', documentId: null, inclusionMode: 'dynamic', retrievalMode: 'broad', priority: 0, enabled: true, protected: false, availability: 'available' }],
      'semantic_model.source_mappings': [{ id: MAPPING, model_id: SOURCE_ID, concept_id: NODE_A, workspace_id: 'workspace-1', document_id: 'doc', field_mappings: [{ mode: 'direct', sourceField: 'x', targetAttribute: 'ref', conceptId: NODE_B }], ai_settings: null, created_by: 'someone', created_at: new Date(), updated_at: new Date() }],
      'semantic_model.derived_sources': [{ id: 'derived-1', model_id: SOURCE_ID, concept_id: NODE_B, source_concept_id: NODE_A, field_mappings: [], conflict_rule: 'most_frequent', order_by: null, created_by: 'someone' }],
      'semantic_model.relation_resolution_rules': [{ id: 'rule-1', model_id: SOURCE_ID, relation_id: RELATION, source_attribute: 'ref', target_attribute: 'ref', strategy: 'exact', ambiguity_policy: 'review', updated_by: 'someone' }],
      'semantic_model.source_resolution_policies': [{ model_id: SOURCE_ID, concept_id: NODE_A, priorities: [{ rank: 1, mappingId: MAPPING }, { rank: 2, mappingId: OTHER_MAPPING }], default_strategy: 'priority', updated_by: 'someone' }],
      'semantic_model.mapping_presets': [{ id: 'preset-1', model_id: SOURCE_ID, concept_id: NODE_A, name: 'P', description: '', field_mappings: [], ai_settings: {}, identity_fields: ['ref'], created_by: 'someone', updated_by: 'someone' }],
    };
    const client = {
      query: jest.fn(async (sql: string, params: unknown[] = []) => {
        if (/^\s*SELECT/i.test(sql)) {
          const table = Object.keys(reads).find((name) => sql.includes(`FROM ${name}`));
          return { rows: table ? reads[table] : [], rowCount: 0 };
        }
        inserts.push({ sql, params });
        return { rows: [], rowCount: 1 };
      }),
    };
    const insertsInto = (table: string) => inserts.filter((item) => item.sql.includes(`INTO ${table} `) || item.sql.includes(`INTO ${table}\n`));
    return { client, inserts, insertsInto };
  }

  function setup(role = 'owner', runtimeResult: unknown = { copied: true, counts: { entities: 12, relationships: 3 } }, population?: unknown) {
    const repository = { findAccessible: jest.fn(), create: jest.fn() };
    const database = { query: jest.fn(), transaction: jest.fn() };
    const graphRepository = { getGraph: jest.fn(), apply: jest.fn() };
    const runtime = { cloneModelData: jest.fn(), deleteModel: jest.fn() };
    const source = { id: SOURCE_ID, role, status: 'draft', description: 'Source', currentDraftVersionId: SOURCE_VERSION, currentPublishedVersionId: null };
    repository.findAccessible.mockImplementation(async (_user: string, id: string) => (id === SOURCE_ID ? source : { id, role: 'owner', status: 'draft' }));
    repository.create.mockResolvedValue({ id: 'clone-model', currentDraftVersionId: 'clone-version', description: 'Source', status: 'draft', role: 'owner' });
    graphRepository.getGraph.mockResolvedValue(sourceGraph());
    database.query.mockResolvedValue({ rows: [{ revision: 4 }] });
    const fake = sourceClient();
    database.transaction.mockImplementation(async (work: (client: unknown) => Promise<unknown>) => work(fake.client));
    if (runtimeResult instanceof Error) runtime.cloneModelData.mockRejectedValue(runtimeResult);
    else runtime.cloneModelData.mockResolvedValue(runtimeResult);
    const service = new SemanticModelService(database as never, repository as never, graphRepository as never, {} as never, { enqueue: jest.fn() } as never, runtime as never,
      (population ? { get: () => population } : undefined) as never);
    return { service, repository, graphRepository, runtime, database, ...fake };
  }

  it('copies structure only, remapping ids embedded in JSON, when nothing is ticked', async () => {
    const { service, graphRepository, insertsInto, runtime } = setup();
    const clone = await service.clone('user-id', SOURCE_ID, 'Source copy', { sources: false });

    expect(clone).toMatchObject({ id: 'clone-model', dataCopy: { status: 'skipped' } });
    expect(graphRepository.apply).toHaveBeenCalledTimes(3);
    const nodeA = graphRepository.apply.mock.calls[0][3].entity;
    const newB = graphRepository.apply.mock.calls[1][3].entity.id;
    expect(nodeA.id).not.toBe(NODE_A);
    expect(nodeA.aliases).toEqual(['alpha']);
    expect(nodeA.attributes[0].description).toBe(`see ${newB}`);
    expect(graphRepository.apply.mock.calls[2][3].entity.sourceNodeTypeId).toBe(nodeA.id);
    expect(insertsInto('semantic_model.identity_rules')[0].params[1]).toBe(nodeA.id);
    expect(insertsInto('semantic_model.canvas_positions')).toHaveLength(0);
    for (const table of ['workspace_links', 'knowledge_bindings', 'source_mappings', 'derived_sources', 'mapping_presets', 'memberships']) {
      expect(insertsInto(`semantic_model.${table}`)).toHaveLength(0);
    }
    expect(runtime.cloneModelData).not.toHaveBeenCalled();
  });

  it('copies sources with every concept, relation and mapping id remapped', async () => {
    const { service, graphRepository, insertsInto } = setup();
    await service.clone('user-id', SOURCE_ID, 'Source copy', { sources: true });

    expect(graphRepository.apply).toHaveBeenCalledTimes(6);
    const newA = graphRepository.apply.mock.calls[0][3].entity.id;
    const newB = graphRepository.apply.mock.calls[1][3].entity.id;
    const newRelation = graphRepository.apply.mock.calls[2][3].entity.id;
    const record = graphRepository.apply.mock.calls[3][3].entity;
    expect(record.values._entity_key).toBe(record.id);
    expect(insertsInto('semantic_model.canvas_positions').map((item) => item.params[1])).toEqual([`typed:${newA}`, 'source:ws:doc:sheet']);
    expect(insertsInto('semantic_model.workspace_links')[0].params).toEqual(['clone-model', 'workspace-1', 'origin', true, 'user-id']);
    expect(insertsInto('semantic_model.knowledge_bindings')[0].params[2]).toBe(newA);

    const mapping = insertsInto('semantic_model.source_mappings')[0];
    const mappingColumns = mapping.sql.match(/\(([^)]*)\)/)![1].split(',').map((column) => column.replace(/"/g, ''));
    const mappingRow = Object.fromEntries(mappingColumns.map((column, index) => [column, mapping.params[index]]));
    expect(mappingRow.model_id).toBe('clone-model');
    expect(mappingRow.concept_id).toBe(newA);
    expect(mappingRow.id).not.toBe(MAPPING);
    expect(JSON.parse(mappingRow.field_mappings as string)[0].conceptId).toBe(newB);
    expect(mappingRow.created_by).toBe('user-id');
    expect(mappingColumns).not.toContain('created_at');

    const derived = insertsInto('semantic_model.derived_sources')[0];
    expect(derived.params).toEqual(expect.arrayContaining([newB, newA]));
    expect(insertsInto('semantic_model.relation_resolution_rules')[0].params).toContain(newRelation);
    const policy = insertsInto('semantic_model.source_resolution_policies')[0];
    const priorities = JSON.parse(policy.params.find((value) => typeof value === 'string' && value.startsWith('[')) as string);
    expect(priorities).toEqual([{ rank: 1, mappingId: mappingRow.id }]);
    expect(insertsInto('semantic_model.mapping_presets')[0].params).toContain(newA);
  });

  it('copies shares only for the owner, the cloner owning the clone', async () => {
    const { service, insertsInto } = setup('owner');
    await service.clone('user-id', SOURCE_ID, 'Copy', { shares: true });
    const shares = insertsInto('semantic_model.memberships');
    expect(shares).toHaveLength(1);
    expect(shares[0].sql).toContain("CASE WHEN role='owner' THEN 'editor'");
    expect(shares[0].params).toEqual([SOURCE_ID, 'clone-model', 'user-id']);

    const viewer = setup('viewer');
    await expect(viewer.service.clone('user-id', SOURCE_ID, 'Copy', { shares: true })).rejects.toMatchObject({ status: 403 });
    expect(viewer.database.transaction).not.toHaveBeenCalled();
  });

  it('lets a viewer clone structure and sources', async () => {
    const { service } = setup('viewer');
    await expect(service.clone('user-id', SOURCE_ID, 'Copy', {})).resolves.toMatchObject({ id: 'clone-model' });
  });

  it('forces sources with data and asks the runtime to copy with the id map', async () => {
    const { service, runtime, insertsInto } = setup();
    const clone = await service.clone('user-id', SOURCE_ID, 'Copy', { sources: false, data: true });

    expect(insertsInto('semantic_model.source_mappings')).toHaveLength(1);
    expect(clone.dataCopy).toEqual({ status: 'copied', records: 12, links: 3 });
    const [sourceId, command, actor] = runtime.cloneModelData.mock.calls[0];
    expect(sourceId).toBe(SOURCE_ID);
    expect(actor).toBe('user-id');
    expect(command.targetModelId).toBe('clone-model');
    expect(command.targetModelVersionId).toBe('clone-version');
    expect(Object.keys(command.idMap.concepts)).toEqual([NODE_A, NODE_B]);
    expect(Object.keys(command.idMap.relations)).toEqual([RELATION]);
    expect(Object.keys(command.idMap.mappings)).toEqual([MAPPING]);
  });

  it('undoes the clone when the source is busy, and keeps it when the copy fails otherwise', async () => {
    const busy = setup('owner', Object.assign(new Error('busy'), { status: 409 }));
    busy.runtime.deleteModel.mockResolvedValue(true);
    await expect(busy.service.clone('user-id', SOURCE_ID, 'Copy', { data: true })).rejects.toMatchObject({ status: 409 });
    expect(busy.runtime.deleteModel).toHaveBeenCalledWith('clone-model', 'user-id');

    const broken = setup('owner', Object.assign(new Error('down'), { status: 503 }));
    const clone = await broken.service.clone('user-id', SOURCE_ID, 'Copy', { data: true });
    expect(clone).toMatchObject({ id: 'clone-model', dataCopy: { status: 'failed' } });
    expect(broken.runtime.deleteModel).not.toHaveBeenCalled();
  });

  it('stamps the copy with the clone build plan only when the source data is current', async () => {
    const plan = { homeWorkspaceId: 'ws', specHash: 'sha256:x', specification: { concepts: [] }, executionFingerprint: 'sha256:fp' };
    const population = { freshness: jest.fn().mockResolvedValue({ state: 'current' }), plannedExecution: jest.fn().mockResolvedValue(plan) };
    const current = setup('owner', undefined, population);
    await current.service.clone('user-id', SOURCE_ID, 'Copy', { data: true });
    expect(population.freshness).toHaveBeenCalledWith('user-id', SOURCE_ID);
    expect(population.plannedExecution).toHaveBeenCalledWith('user-id', 'clone-model');
    expect(current.runtime.cloneModelData.mock.calls[0][1]).toMatchObject(plan);

    population.freshness.mockResolvedValue({ state: 'outdated' });
    const outdated = setup('owner', undefined, population);
    await outdated.service.clone('user-id', SOURCE_ID, 'Copy', { data: true });
    expect(outdated.runtime.cloneModelData.mock.calls[0][1].specHash).toBeUndefined();
  });

  it('reports a source without data as nothing to copy', async () => {
    const { service } = setup('owner', { copied: false, reason: 'no_data' });
    await expect(service.clone('user-id', SOURCE_ID, 'Copy', { data: true })).resolves.toMatchObject({ dataCopy: { status: 'skipped', reason: 'no_data' } });
  });
});

describe('remapCloneIds', () => {
  it('rewrites mapped ids in strings and nested JSON and leaves others', () => {
    const from = '11111111-1111-4111-8111-111111111111';
    const to = '22222222-2222-4222-8222-222222222222';
    const other = '33333333-3333-4333-8333-333333333333';
    const ids = new Map([[from, to]]);
    expect(remapCloneIds(`typed:${from}`, ids)).toBe(`typed:${to}`);
    expect(remapCloneIds({ a: [from, { [from]: other }] }, ids)).toEqual({ a: [to, { [to]: other }] });
    expect(remapCloneIds(null, ids)).toBeNull();
  });
});

describe('SemanticModelService permanent delete', () => {
  const repository = { findAccessible: jest.fn() };
  const runtime = { deleteModel: jest.fn() };
  const queries: string[] = [];
  const client = { query: jest.fn(async (sql: string) => { queries.push(sql); return { rows: [], rowCount: 1 }; }) };
  const database = { transaction: jest.fn(async (work: (c: typeof client) => Promise<unknown>) => work(client)) };
  const service = new SemanticModelService(database as never, repository as never, {} as never, {} as never, {} as never, runtime as never);

  beforeEach(() => {
    jest.clearAllMocks();
    queries.length = 0;
  });

  it('lets only the owner delete', async () => {
    repository.findAccessible.mockResolvedValue({ id: 'model-id', role: 'editor', status: 'draft' });
    await expect(service.deletePermanently('user-id', 'model-id')).rejects.toMatchObject({ status: 403 });
    expect(runtime.deleteModel).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('purges the runtime first, then deletes every row of the model here', async () => {
    repository.findAccessible.mockResolvedValue({ id: 'model-id', role: 'owner', status: 'archived' });
    const order: string[] = [];
    runtime.deleteModel.mockImplementation(async () => { order.push('runtime'); return true; });
    database.transaction.mockImplementationOnce(async (work) => { order.push('back'); return work(client); });
    await service.deletePermanently('user-id', 'model-id');
    expect(order).toEqual(['runtime', 'back']);
    expect(runtime.deleteModel).toHaveBeenCalledWith('model-id', 'user-id');
    expect(queries.at(-1)).toContain('DELETE FROM semantic_model.models WHERE id=$1');
    expect(queries.findIndex((q) => q.includes('relation_types'))).toBeLessThan(queries.findIndex((q) => q.includes('node_types')));
  });

  it('keeps the model when a job is still running in the runtime', async () => {
    repository.findAccessible.mockResolvedValue({ id: 'model-id', role: 'owner', status: 'draft' });
    runtime.deleteModel.mockRejectedValue(new ConflictException(ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT, 'job running'));
    await expect(service.deletePermanently('user-id', 'model-id')).rejects.toMatchObject({ status: 409 });
    expect(database.transaction).not.toHaveBeenCalled();
  });
});
