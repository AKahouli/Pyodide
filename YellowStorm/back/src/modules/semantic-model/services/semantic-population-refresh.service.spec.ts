import { ModelSpecificationService } from './model-specification.service';
import { SemanticPopulationRefreshService } from './semantic-population-refresh.service';
import { ErrorCode } from '@modules/exceptions/constants/error-codes';

const NODES = [
  {
    id: 'c-customer', key: 'customer', label: 'Customer',
    attributes: [{ key: 'customer_id', label: 'Id', type: 'text' }, { key: 'name', label: 'Name', type: 'text' }],
  },
  {
    id: 'c-contract', key: 'contract', label: 'Contract',
    attributes: [{ key: 'contract_id', label: 'Id', type: 'text' }, { key: 'customer_ref', label: 'Customer', type: 'text' }],
  },
];

const MAPPING = (overrides: Record<string, unknown> = {}) => ({
  id: 'm-1',
  conceptId: 'c-customer',
  workspaceId: 'ws-1',
  documentId: 'd-1',
  sheetName: 'Sheet1',
  assetKind: 'excel_sheet',
  fieldMappings: [
    { sourceField: 'customer_id', targetAttribute: 'customer_id', mode: 'direct' },
    { sourceField: 'legal_name', targetAttribute: 'name', mode: 'direct' },
  ],
  status: 'ready',
  identityFields: ['customer_id'],
  sourceEnabled: true,
  validatedSourceVersion: 'sha256:abc',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  ...overrides,
});

const setup = (
  mappings: unknown[] = [MAPPING()],
  identity: Record<string, string[]> = { 'c-customer': ['customer_id'] },
  relations: unknown[] = [],
  relationRules: unknown[] = [],
  records: unknown[] = [],
  recordRelations: unknown[] = [],
) => {
  const database = {
    query: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM semantic_model.node_types')) return { rows: NODES };
      if (sql.includes('FROM semantic_model.relation_types')) return { rows: relations };
      if (sql.includes('FROM semantic_model.identity_rules')) {
        return { rows: Object.entries(identity).map(([conceptId, fields]) => ({ conceptId, fields })) };
      }
      if (sql.includes('FROM semantic_model.relation_resolution_rules')) return { rows: relationRules };
      if (sql.includes('FROM semantic_model.workspace_links')) {
        return { rows: [{ workspaceId: 'ws-1', role: 'origin' }] };
      }
      if (sql.includes('FROM semantic_model.source_mappings')) {
        if (sql.includes('m.id=$2')) {
          return { rows: mappings.filter((mapping) => (mapping as { id: string }).id === params[1]) };
        }
        return { rows: mappings };
      }
      if (sql.includes('FROM semantic_model.records')) return { rows: records };
      if (sql.includes('FROM semantic_model.record_relations')) return { rows: recordRelations };
      throw new Error(`unexpected query: ${sql}`);
    }),
  };
  const models = {
    requireActiveRole: jest.fn(async () => ({ id: 'model-1', currentDraftVersionId: 'v-1' })),
    requireRole: jest.fn(async () => ({ id: 'model-1', currentDraftVersionId: 'v-1' })),
  };
  const documents = {
    findById: jest.fn(async () => ({
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', originalName: 'a.xlsx',
      contentHash: 'sha256:abc', updatedAt: '2026-01-01', uploadedAt: '2026-01-01', size: 100,
      createdBy: 'uploader-1', indexingStatus: 'ready',
    })),
  };
  const runtime = {
    mirrorSpecification: jest.fn(async () => ({ reused: false })),
    appendManualRows: jest.fn(async () => undefined),
    commitManualSnapshot: jest.fn(async () => ({ reused: false })),
    requestPopulationRun: jest.fn(async () => ({ jobId: 'j-1', status: 'queued', reused: false })),
    getJob: jest.fn(async () => ({ jobId: 'j-1', jobType: 'population.run', modelId: 'model-1', state: 'completed' })),
    getBoundRecords: jest.fn(async () => ({
      dataRevisionId: 'dr-1',
      entities: [{ entityId: 'e-1', conceptId: 'c-customer', label: 'Acme', attributes: { name: 'Acme' }, provenance: {} }],
      relationships: [],
      counts: { entities: 1, assertions: 1, relationships: 0 },
      specification: {
        concepts: [{ conceptId: 'c-customer', label: 'Customer', allowedFields: ['customer_id', 'name'] }],
        relations: [],
      },
    })),
  };
  const aiExtractionAgent = {
    resolveAgent: jest.fn(async () => ({ slug: 'semantic-field-extraction', llmModel: 'gpt-5.4-nano' })),
  };
  const service = new SemanticPopulationRefreshService(
    database as any, models as any, documents as any,
    new ModelSpecificationService(), runtime as any, aiExtractionAgent as any,
  );
  return { database, models, documents, runtime, service, aiExtractionAgent };
};

describe('SemanticPopulationRefreshService', () => {
  it('returns only matching population jobs', async () => {
    const { runtime, service } = setup();
    await expect(service.getJob('u-1', 'model-1', 'j-1')).resolves.toMatchObject({ state: 'completed' });
    runtime.getJob.mockResolvedValueOnce({ jobId: 'j-2', jobType: 'datasource.discovery', modelId: 'model-1', state: 'completed' });
    await expect(service.getJob('u-1', 'model-1', 'j-2')).rejects.toThrow('Population job not found');
  });

  it('shapes bound runtime entities as the existing Records contract', async () => {
    const { service } = setup();
    const result = await service.boundRecords('u-1', 'model-1', 25);
    expect(result).toMatchObject({ dataRevisionId: 'dr-1', summary: { entities: 1, resolvedRelations: 0 } });
    expect(result.concepts[0]).toMatchObject({ id: 'c-customer', entities: [{ id: 'e-1', values: { name: 'Acme' } }] });
  });

  it('says whether the data in use was built from the model as it is now', async () => {
    const { runtime, service, models } = setup();
    await service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } });
    const planned = (runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>]>)[0][0].payload.populationExecutionFingerprint;
    (runtime.getBoundRecords as jest.Mock).mockResolvedValueOnce({ ...(await runtime.getBoundRecords()), executionFingerprint: planned });
    await expect(service.freshness('u-1', 'model-1')).resolves.toEqual({ state: 'current' });
    (runtime.getBoundRecords as jest.Mock).mockResolvedValueOnce({ ...(await runtime.getBoundRecords()), executionFingerprint: 'sha256:older' });
    await expect(service.freshness('u-1', 'model-1')).resolves.toEqual({ state: 'outdated' });
    runtime.getBoundRecords.mockRejectedValueOnce(new Error('active_binding_not_found'));
    await expect(service.freshness('u-1', 'model-1')).resolves.toEqual({ state: 'never_run' });
    // Reading freshness never starts a run or touches the runtime specification.
    expect(runtime.requestPopulationRun).toHaveBeenCalledTimes(1);
    expect(models.requireRole).toHaveBeenCalled();
  });

  it('sends business synonyms in the specification only when there are some', async () => {
    const { database, runtime, service } = setup();
    await service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } });
    const plain = (runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>]>)[0][0];
    expect(plain.payload.specification.concepts[0]).not.toHaveProperty('aliases');
    expect(plain.payload.specification.concepts[0]).not.toHaveProperty('fieldAliases');
    const query = database.query.getMockImplementation()!;
    database.query.mockImplementation(async (sql: string, params: unknown[] = []) => sql.includes('FROM semantic_model.node_types')
      ? { rows: [{ ...NODES[0], aliases: [' Client ', 'Client', ''], attributes: [NODES[0].attributes[0], { ...NODES[0].attributes[1], aliases: ['Company name'] }] }, NODES[1]] }
      : query(sql, params));
    await service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } });
    const aliased = (runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>]>)[1][0];
    expect(aliased.payload.specification.concepts[0]).toMatchObject({ aliases: ['Client'], fieldAliases: { name: ['Company name'] } });
    expect(aliased.payload.specification.specHash).not.toBe(plain.payload.specification.specHash);
  });

  it('explains where each value came from and what is missing', async () => {
    const { runtime, service } = setup();
    runtime.getBoundRecords.mockResolvedValueOnce({
      dataRevisionId: 'dr-1',
      entities: [{
        entityId: 'e-1', conceptId: 'c-customer', label: 'Acme', attributes: { name: 'Acme', customer_id: '7' }, provenance: {},
        origins: {
          name: { kind: 'source', assetId: 'd-1', rowNumber: 4, column: 'name' },
          customer_id: { kind: 'source', assetId: 'manual:snap-1', rowNumber: 'r1', column: 'customer_id' },
        },
      }],
      relationships: [],
      counts: { entities: 1, assertions: 2, relationships: 0 },
      gaps: {
        missingValues: [{ conceptId: 'c-customer', attribute: 'name', missing: 2, total: 5 }],
        unresolvedLinks: [{ relationId: 'r-1', kind: 'unresolved_reference', count: 3 }],
        other: [],
      },
      specification: {
        concepts: [{ conceptId: 'c-customer', label: 'Customer', allowedFields: ['customer_id', 'name'] }],
        relations: [{ relationId: 'r-1', label: 'belongs to' }],
      },
    } as never);
    const result = await service.boundRecords('u-1', 'model-1', 25);
    const entity = result.concepts[0].entities[0];
    expect(entity.provenance.name).toMatchObject({
      mappingId: 'm-1', rowNumber: 4,
      source: { documentId: 'd-1', documentName: 'a.xlsx', sheetName: 'Sheet1' },
      field: { method: 'direct_mapping', reference: 'name' },
    });
    expect(entity.provenance.customer_id).toEqual({ mappingId: '', source: { kind: 'manual', documentName: '' } });
    expect(result.gaps.missingValues[0]).toMatchObject({ conceptLabel: 'Customer', attributeLabel: 'Name', missing: 2 });
    expect(result.gaps.unresolvedLinks[0]).toMatchObject({ relationLabel: 'belongs to', count: 3 });
    expect(result.summary.unresolvedRelations).toBe(3);
  });

  it('reads every readable file of a workspace mapping, and sees a new file as a change', async () => {
    const file = (id: string, overrides: Record<string, unknown> = {}) => ({
      id, workspaceId: 'ws-1', originalName: `${id}.pdf`, mimeType: 'application/pdf', isFolder: false, parentId: 'folder-1',
      contentHash: `sha256:${id}`, updatedAt: '2026-01-01', uploadedAt: '2026-01-01', size: 10, createdBy: 'u-9', indexingStatus: 'ready',
      ...overrides,
    });
    const workspace = MAPPING({
      scope: 'workspace', folderId: 'folder-1', documentId: 'workspace:ws-1:folder-1', sheetName: '', assetKind: 'document',
      validatedSourceVersion: null,
      fieldMappings: [
        { sourceField: 'Customer Id', targetAttribute: 'customer_id', mode: 'extract' },
        { sourceField: 'document_name', targetAttribute: 'name', mode: 'metadata' },
      ],
    });
    const { documents, runtime, service } = setup([workspace]);
    const listing = [
      file('b'), file('a'),
      file('pending', { indexingStatus: 'processing' }),
      file('elsewhere', { parentId: 'other-folder' }),
      file('sheet', { mimeType: 'text/csv' }),
      { id: 'folder-1', isFolder: true, mimeType: '', parentId: null },
    ];
    (documents as any).listAllInWorkspace = jest.fn(async () => listing);
    const accepted = await service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } });
    const first = (runtime.requestPopulationRun.mock.calls[0] as any)[0].payload;
    expect(first.sources.map((source: any) => source.source.assetId)).toEqual(['a', 'b']);
    expect(first.sources[0]).toMatchObject({ sourceKind: 'document', source: { assetVersionId: 'sha256:a', originalName: 'a.pdf' } });
    expect(first.specification.sourceScope).toEqual([{ workspaceId: 'ws-1', assetId: 'workspace:ws-1:folder-1' }]);
    expect(accepted).toMatchObject({ sourceCount: 2, waitingFiles: 1 });
    expect(documents.findById).not.toHaveBeenCalled();

    listing.push(file('c'));
    await service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } });
    const second = (runtime.requestPopulationRun.mock.calls[1] as any)[0].payload;
    expect(second.sources).toHaveLength(3);
    expect(second.populationExecutionFingerprint).not.toBe(first.populationExecutionFingerprint);
  });

  it('pages and searches the records of one concept, and answers nothing yet before any data exists', async () => {
    const { runtime, service } = setup();
    (runtime as any).searchConceptRecords = jest.fn(async () => ({
      modelId: 'model-1', conceptId: 'c-customer', dataRevisionId: 'dr-1', total: 120, offset: 40, limit: 20,
      entities: [{ entityId: 'e-1', conceptId: 'c-customer', label: 'Acme', attributes: { name: 'Acme' }, provenance: {}, origins: {} }],
    }));
    await expect(service.conceptRecords('u-1', 'model-1', 'c-customer', { q: '  acme ', limit: 20, offset: 40 })).resolves.toMatchObject({
      dataRevisionId: 'dr-1', total: 120, offset: 40, records: [{ id: 'e-1', label: 'Acme', values: { name: 'Acme' } }],
    });
    expect((runtime as any).searchConceptRecords).toHaveBeenCalledWith('model-1', 'c-customer', 'u-1',
      { q: 'acme', limit: 20, offset: 40, dataRevisionId: undefined });
    (runtime as any).searchConceptRecords.mockRejectedValueOnce(Object.assign(new Error('HTTP 404'), { status: 404 }));
    await expect(service.conceptRecords('u-1', 'model-1', 'c-customer', {})).resolves.toMatchObject({ total: 0, records: [] });
  });

  it('assembles, mirrors and runs a whole-model refresh', async () => {
    const { database, runtime, service } = setup();
    const result = await service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } });
    expect(result.jobId).toBe('j-1');
    expect(result.skipped).toEqual([]);
    expect(runtime.mirrorSpecification).toHaveBeenCalledWith(expect.objectContaining({
      homeWorkspaceId: 'ws-1', modelId: 'model-1', modelVersionId: 'v-1',
    }));
    const calls = runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>, string]>;
    const command = calls[0][0];
    expect(command.workspaceId).toBe('ws-1');
    expect(command.payload.purpose).toBe('build');
    expect(command.payload.specification.concepts).toHaveLength(1);
    expect(command.payload.sources).toHaveLength(1);
    expect(command.payload.populationExecutionFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(command.payload.sources[0]).toMatchObject({
      conceptId: 'c-customer',
      columnMapping: { customer_id: 'customer_id', legal_name: 'name' },
      labelField: 'name',
    });
    expect(command.payload.sources[0].source).toMatchObject({
      workspaceId: 'ws-1', assetId: 'd-1', assetVersionId: 'sha256:abc',
    });
    const ruleQuery = database.query.mock.calls.find(([sql]) =>
      sql.includes('FROM semantic_model.relation_resolution_rules'))?.[0] ?? '';
    expect(ruleQuery).not.toMatch(/source_concept_id|target_concept_id|cardinality/);
  });

  it('fingerprints the JSON-normalized source payload', async () => {
    const { documents, runtime, service } = setup();
    documents.findById.mockResolvedValueOnce({
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', originalName: 'a.xlsx', size: 100,
      createdBy: 'uploader-1', indexingStatus: 'ready',
      contentHash: 'sha256:abc', updatedAt: '2026-01-01', uploadedAt: undefined,
    } as any);

    await service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } });

    const calls = runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>, string]>;
    const command = calls[0][0];
    const source = command.payload.sources[0];
    expect(source).toEqual(JSON.parse(JSON.stringify(source)));
    expect(command.payload.populationExecutionFingerprint).toBe(new ModelSpecificationService().hashCanonical({
      specHash: command.payload.specHash,
      sources: command.payload.sources.map((entry: Record<string, any>) => ({
        conceptId: entry.conceptId,
        sourceKind: entry.sourceKind,
        source: entry.source,
        mappingVersion: entry.mappingVersion,
        columnMapping: entry.columnMapping ?? null,
        constantMapping: entry.constantMapping ?? null,
        fieldMappings: entry.fieldMappings ?? null,
        options: entry.options ?? {},
        labelField: entry.labelField ?? null,
      })),
      relationBindings: command.payload.relationBindings,
      aiExtraction: command.payload.aiExtraction,
      populationEngineVersion: 'r1-mvp-5',
    }));
  });

  it('scopes a single mapping to its concept only', async () => {
    const second = MAPPING({
      id: 'm-2', conceptId: 'c-contract', documentId: 'd-2', identityFields: ['contract_id'],
      fieldMappings: [
        { sourceField: 'contract_id', targetAttribute: 'contract_id', mode: 'direct' },
        { sourceField: 'customer_ref', targetAttribute: 'customer_ref', mode: 'direct' },
      ],
    });
    const { runtime, service } = setup([MAPPING(), second], {
      'c-customer': ['customer_id'],
      'c-contract': ['contract_id'],
    });
    const result = await service.requestRefresh('u-1', 'model-1', {
      purpose: 'refresh', scope: { kind: 'mapping', mappingId: 'm-2' },
    });
    expect(result.jobId).toBe('j-1');
    const scoped = runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>, string]>;
    const command = scoped[0][0];
    expect(command.payload.sources).toHaveLength(1);
    expect(command.payload.sources[0].conceptId).toBe('c-contract');
    expect(command.payload.specification.concepts.map((c: { conceptId: string }) => c.conceptId)).toEqual(['c-contract']);
  });

  it('admits document mappings with extraction recipes and current metadata', async () => {
    const doc = MAPPING({
      id: 'm-doc', assetKind: 'document', sheetName: '',
      fieldMappings: [
        { sourceField: 'Customer ID', targetAttribute: 'customer_id', mode: 'extract' },
        { sourceField: 'document_name', targetAttribute: 'name', mode: 'metadata' },
      ],
    });
    const { documents, runtime, service } = setup([doc]);
    documents.findById.mockResolvedValueOnce({
      mimeType: 'application/pdf', originalName: 'agreement.pdf', createdBy: 'uploader-1',
      contentHash: 'sha256:abc', updatedAt: '2026-01-01', uploadedAt: '2026-01-01',
      size: 100, indexingStatus: 'ready',
    });
    await service.requestRefresh('u-1', 'model-1', {
      purpose: 'build', scope: { kind: 'mapping', mappingId: 'm-doc' },
    });
    const calls = runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>, string]>;
    expect(calls[0][0].payload.sources[0]).toMatchObject({
      sourceKind: 'document', conceptId: 'c-customer',
      fieldMappings: doc.fieldMappings,
      source: { originalName: 'agreement.pdf', uploaderUserId: 'uploader-1', indexingStatus: 'ready' },
    });
  });

  it('carries the per-field extraction strategy into the population payload and fingerprint', async () => {
    const doc = MAPPING({
      id: 'm-doc', assetKind: 'document', sheetName: '',
      fieldMappings: [
        { sourceField: 'Customer ID', targetAttribute: 'customer_id', mode: 'extract', extractionStrategy: 'ai' },
        { sourceField: 'Name', targetAttribute: 'name', mode: 'extract', extractionStrategy: 'deterministic' },
      ],
    });
    const { documents, runtime, service } = setup([doc]);
    documents.findById.mockResolvedValueOnce({
      mimeType: 'application/pdf', originalName: 'agreement.pdf', createdBy: 'uploader-1',
      contentHash: 'sha256:abc', updatedAt: '2026-01-01', uploadedAt: '2026-01-01',
      size: 100, indexingStatus: 'ready',
    });

    await service.requestRefresh('u-1', 'model-1', {
      purpose: 'build', scope: { kind: 'mapping', mappingId: 'm-doc' },
    });

    const calls = runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>, string]>;
    expect(calls[0][0].payload.sources[0].fieldMappings).toEqual([
      { sourceField: 'Customer ID', targetAttribute: 'customer_id', mode: 'extract', extractionStrategy: 'ai' },
      { sourceField: 'Name', targetAttribute: 'name', mode: 'extract', extractionStrategy: 'deterministic' },
    ]);
    expect(calls[0][0].payload.populationExecutionFingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it('binds the AI agent identity into revision identity so a model change is a new revision', async () => {
    const doc = MAPPING({
      id: 'm-doc', assetKind: 'document', sheetName: '',
      fieldMappings: [
        { sourceField: 'Customer ID', targetAttribute: 'customer_id', mode: 'extract', extractionStrategy: 'ai' },
      ],
    });
    const first = setup([doc]);
    first.documents.findById.mockResolvedValue({
      mimeType: 'application/pdf', originalName: 'agreement.pdf', createdBy: 'uploader-1',
      contentHash: 'sha256:abc', updatedAt: '2026-01-01', uploadedAt: '2026-01-01',
      size: 100, indexingStatus: 'ready',
    });
    await first.service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'mapping', mappingId: 'm-doc' } });
    const firstCall = (first.runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>, string]>)[0][0];
    expect(firstCall.payload.aiExtraction).toEqual({
      agentSlug: 'semantic-field-extraction', model: 'gpt-5.4-nano', contractVersion: 'ai-attribute-v1',
    });

    // The admin points the agent at another model: the fingerprint must move.
    const second = setup([doc]);
    second.aiExtractionAgent.resolveAgent.mockResolvedValue({ slug: 'semantic-field-extraction', llmModel: 'other-model' });
    second.documents.findById.mockResolvedValue({
      mimeType: 'application/pdf', originalName: 'agreement.pdf', createdBy: 'uploader-1',
      contentHash: 'sha256:abc', updatedAt: '2026-01-01', uploadedAt: '2026-01-01',
      size: 100, indexingStatus: 'ready',
    });
    await second.service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'mapping', mappingId: 'm-doc' } });
    const secondCall = (second.runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>, string]>)[0][0];
    expect(secondCall.payload.populationExecutionFingerprint)
      .not.toEqual(firstCall.payload.populationExecutionFingerprint);
  });

  it('omits the AI identity when no mapping uses AI extraction', async () => {
    const doc = MAPPING({
      id: 'm-doc', assetKind: 'document', sheetName: '',
      fieldMappings: [{ sourceField: 'Customer ID', targetAttribute: 'customer_id', mode: 'extract' }],
    });
    const { documents, runtime, service, aiExtractionAgent } = setup([doc]);
    documents.findById.mockResolvedValueOnce({
      mimeType: 'application/pdf', originalName: 'agreement.pdf', createdBy: 'uploader-1',
      contentHash: 'sha256:abc', updatedAt: '2026-01-01', uploadedAt: '2026-01-01',
      size: 100, indexingStatus: 'ready',
    });
    await service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'mapping', mappingId: 'm-doc' } });
    const call = (runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>, string]>)[0][0];
    expect(call.payload.aiExtraction).toBeNull();
    expect(aiExtractionAgent.resolveAgent).not.toHaveBeenCalled();
  });

  it('uses the concept attribute label for document extraction mappings without a source field', async () => {
    const doc = MAPPING({
      id: 'm-doc', assetKind: 'document', sheetName: '',
      fieldMappings: [
        { sourceField: null, targetAttribute: 'customer_id', mode: 'extract' },
        { sourceField: null, targetAttribute: 'name', mode: 'extract' },
      ],
    });
    const { documents, runtime, service } = setup([doc]);
    documents.findById.mockResolvedValueOnce({
      mimeType: 'application/pdf', originalName: 'agreement.pdf', createdBy: 'uploader-1',
      contentHash: 'sha256:abc', updatedAt: '2026-01-01', uploadedAt: '2026-01-01',
      size: 100, indexingStatus: 'ready',
    });

    await service.requestRefresh('u-1', 'model-1', {
      purpose: 'build', scope: { kind: 'mapping', mappingId: 'm-doc' },
    });

    const calls = runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>, string]>;
    expect(calls[0][0].payload.sources[0].fieldMappings).toEqual([
      { sourceField: 'Id', targetAttribute: 'customer_id', mode: 'extract' },
      { sourceField: 'Name', targetAttribute: 'name', mode: 'extract' },
    ]);
  });

  it('rejects mappings that do not directly map every identity field', async () => {
    const mapping = MAPPING({ fieldMappings: [{ sourceField: 'legal_name', targetAttribute: 'name', mode: 'direct' }] });
    const { runtime, service } = setup([mapping]);
    await expect(service.requestRefresh('u-1', 'model-1', {
      purpose: 'build', scope: { kind: 'mapping', mappingId: 'm-1' },
    })).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED });
    expect(runtime.mirrorSpecification).not.toHaveBeenCalled();
  });

  it('rejects sources that changed since mapping validation', async () => {
    const { documents, runtime, service } = setup();
    documents.findById.mockResolvedValueOnce({
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', originalName: 'a.xlsx',
      contentHash: 'sha256:new', updatedAt: '2026-01-02', uploadedAt: '2026-01-02', size: 100,
      createdBy: 'uploader-1', indexingStatus: 'ready',
    });
    await expect(service.requestRefresh('u-1', 'model-1', {
      purpose: 'refresh', scope: { kind: 'mapping', mappingId: 'm-1' },
    })).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_REVISION_CONFLICT });
    expect(runtime.mirrorSpecification).not.toHaveBeenCalled();
  });

  it('rejects mappings that target attributes removed from the current draft', async () => {
    const mapping = MAPPING({ fieldMappings: [
      { sourceField: 'customer_id', targetAttribute: 'customer_id', mode: 'direct' },
      { sourceField: 'legacy', targetAttribute: 'removed_field', mode: 'direct' },
    ] });
    const { runtime, service } = setup([mapping]);
    await expect(service.requestRefresh('u-1', 'model-1', {
      purpose: 'build', scope: { kind: 'mapping', mappingId: 'm-1' },
    })).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED });
    expect(runtime.requestPopulationRun).not.toHaveBeenCalled();
  });

  it('rejects duplicate target attributes before queueing', async () => {
    const mapping = MAPPING({ fieldMappings: [
      { sourceField: 'id_one', targetAttribute: 'customer_id', mode: 'direct' },
      { sourceField: 'id_two', targetAttribute: 'customer_id', mode: 'direct' },
    ] });
    const { runtime, service } = setup([mapping]);
    await expect(service.requestRefresh('u-1', 'model-1', {
      purpose: 'build', scope: { kind: 'mapping', mappingId: 'm-1' },
    })).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED });
    expect(runtime.requestPopulationRun).not.toHaveBeenCalled();
  });

  it('skips mappings whose concept is absent from the current draft', async () => {
    const stale = MAPPING({ id: 'm-stale', conceptId: 'c-missing', documentId: 'd-stale' });
    const { runtime, service } = setup([MAPPING(), stale]);
    const result = await service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } });
    expect(result.skipped).toEqual([expect.objectContaining({ mappingId: 'm-stale' })]);
    const calls = runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>, string]>;
    expect(calls[0][0].payload.sources).toHaveLength(1);
  });

  it('rejects concepts without usable identity', async () => {
    const { service } = setup([MAPPING()], {});
    await expect(service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } }))
      .rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED });
  });

  it('rejects unknown mappings and missing mapping ids', async () => {
    const { service } = setup([]);
    await expect(service.requestRefresh('u-1', 'model-1', {
      purpose: 'build', scope: { kind: 'mapping', mappingId: 'nope' },
    })).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_NOT_FOUND });
    await expect(service.requestRefresh('u-1', 'model-1', {
      purpose: 'build', scope: { kind: 'mapping' } as never,
    })).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED });
  });

  it('derives deterministic idempotency keys per scope', async () => {
    const { runtime, service } = setup();
    const input = { purpose: 'build', scope: { kind: 'model' } } as const;
    await service.requestRefresh('u-1', 'model-1', input);
    await service.requestRefresh('u-1', 'model-1', input);
    const keys = (runtime.requestPopulationRun.mock.calls as unknown as Array<[unknown, string]>).map((call) => call[1]);
    const [first, second] = keys;
    expect(first).toHaveLength(64);
    expect(first).toBe(second);
  });

  it('changes the idempotency key when a mapping revision changes', async () => {
    const mapping = MAPPING();
    const { runtime, service } = setup([mapping]);
    const input = { purpose: 'refresh', scope: { kind: 'model' } } as const;
    await service.requestRefresh('u-1', 'model-1', input);
    mapping.updatedAt = new Date('2026-01-02T00:00:00.000Z');
    await service.requestRefresh('u-1', 'model-1', input);
    const keys = (runtime.requestPopulationRun.mock.calls as unknown as Array<[unknown, string]>).map((call) => call[1]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('binds a relation through a mapped reference to the target identity', async () => {
    const contract = MAPPING({
      id: 'm-2', conceptId: 'c-contract', documentId: 'd-2', identityFields: ['contract_id'],
      fieldMappings: [
        { sourceField: 'contract_id', targetAttribute: 'contract_id', mode: 'direct' },
        { sourceField: 'customer_ref', targetAttribute: 'customer_ref', mode: 'direct' },
      ],
    });
    const relation = {
      id: 'r-1', key: 'belongs_to', sourceNodeTypeId: 'c-contract', targetNodeTypeId: 'c-customer', cardinality: 'many_to_one',
    };
    const rule = {
      relationId: 'r-1', sourceConceptId: 'c-contract', targetConceptId: 'c-customer',
      sourceAttribute: 'customer_ref', targetAttribute: 'customer_id', cardinality: 'many_to_one',
      strategy: 'exact', ambiguityPolicy: 'review',
    };
    const { runtime, service } = setup([MAPPING(), contract], {
      'c-customer': ['customer_id'], 'c-contract': ['contract_id'],
    }, [relation], [rule]);
    await service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } });
    const calls = runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>, string]>;
    expect(calls[0][0].payload.relationBindings).toEqual([{
      relationId: 'r-1', referenceField: 'customer_ref', targetField: 'customer_id',
    }]);
    rule.sourceAttribute = 'contract_id';
    await service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } });
    expect(calls[1][1]).not.toBe(calls[0][1]);
  });

  it('binds one-to-many relations through one field of a composite target identity', async () => {
    const contract = MAPPING({
      id: 'm-2', conceptId: 'c-contract', documentId: 'd-2', identityFields: ['customer_ref', 'contract_id'],
      fieldMappings: [
        { sourceField: 'contract_id', targetAttribute: 'contract_id', mode: 'direct' },
        { sourceField: 'customer_ref', targetAttribute: 'customer_ref', mode: 'direct' },
      ],
    });
    const relation = {
      id: 'r-1', key: 'customer_contracts', sourceNodeTypeId: 'c-customer',
      targetNodeTypeId: 'c-contract', cardinality: 'one_to_many',
    };
    const rule = {
      relationId: 'r-1', sourceConceptId: 'c-customer', targetConceptId: 'c-contract',
      sourceAttribute: 'customer_id', targetAttribute: 'customer_ref', cardinality: 'one_to_many',
      strategy: 'exact', ambiguityPolicy: 'review',
    };
    const { runtime, service } = setup([MAPPING(), contract], {
      'c-customer': ['customer_id'], 'c-contract': ['customer_ref', 'contract_id'],
    }, [relation], [rule]);

    await service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } });

    const calls = runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>, string]>;
    expect(calls[0][0].payload.relationBindings).toEqual([{
      relationId: 'r-1', referenceField: 'customer_id', targetField: 'customer_ref',
    }]);
  });

  it('accepts a mapped type-compatible relation target outside the target identity', async () => {
    const contract = MAPPING({
      id: 'm-2', conceptId: 'c-contract', documentId: 'd-2', identityFields: ['contract_id'],
      fieldMappings: [
        { sourceField: 'contract_id', targetAttribute: 'contract_id', mode: 'direct' },
        { sourceField: 'customer_ref', targetAttribute: 'customer_ref', mode: 'direct' },
      ],
    });
    const relation = {
      id: 'r-1', key: 'customer_contracts', sourceNodeTypeId: 'c-customer',
      targetNodeTypeId: 'c-contract', cardinality: 'one_to_many',
    };
    const rule = {
      relationId: 'r-1', sourceConceptId: 'c-customer', targetConceptId: 'c-contract',
      sourceAttribute: 'customer_id', targetAttribute: 'customer_ref', cardinality: 'one_to_many',
      strategy: 'exact', ambiguityPolicy: 'review',
    };
    const { runtime, service } = setup([MAPPING(), contract], {
      'c-customer': ['customer_id'], 'c-contract': ['contract_id'],
    }, [relation], [rule]);

    await service.requestRefresh('u-1', 'model-1', {
      purpose: 'build', scope: { kind: 'model' },
    });
    const calls = runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>, string]>;
    expect(calls[0][0].payload.relationBindings).toEqual([{
      relationId: 'r-1', referenceField: 'customer_id', targetField: 'customer_ref',
    }]);
  });

  it('compiles structured constants without replacing direct fields', async () => {
    const mapping = MAPPING({ fieldMappings: [
      { sourceField: 'customer_id', targetAttribute: 'customer_id', mode: 'direct' },
      { sourceField: null, targetAttribute: 'name', mode: 'constant', constantValue: 'Unknown' },
    ] });
    const { runtime, service } = setup([mapping]);
    await service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } });
    const calls = runtime.requestPopulationRun.mock.calls as unknown as Array<[Record<string, any>, string]>;
    expect(calls[0][0].payload.sources[0]).toMatchObject({
      columnMapping: { customer_id: 'customer_id' }, constantMapping: { name: 'Unknown' },
    });
  });

  it('caps whole-model refreshes at 25 sources', async () => {
    const mappings = Array.from({ length: 26 }, (_, index) => MAPPING({ id: `m-${index}`, documentId: `d-${index}` }));
    const { service } = setup(mappings);
    await expect(service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } }))
      .rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED });
  });

  it('sends records typed by hand as a manual source, with their links', async () => {
    const records = [
      { id: 'r-1', nodeTypeId: 'c-customer', label: 'Acme', values: { name: 'Acme', _entity_key: 'x' } },
      { id: 'r-2', nodeTypeId: 'c-customer', label: 'Globex', values: { name: 'Globex' } },
    ];
    const links = [{ relationTypeId: 'rel-1', sourceRecordId: 'r-1', targetRecordId: 'r-2' }];
    const { runtime, service } = setup([], {}, [], [], records, links);
    await service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } });
    const [modelId, snapshotId, batch] = runtime.appendManualRows.mock.calls[0] as unknown as [string, string, { rows: Array<{ values: object }>; links: unknown[] }];
    expect(modelId).toBe('model-1');
    expect(snapshotId).toMatch(/^m[0-9a-f]{40}$/);
    expect(batch.rows[0].values).toEqual({ name: 'Acme' });
    expect(batch.links).toEqual([{ relationId: 'rel-1', sourceRowKey: 'r-1', targetRowKey: 'r-2' }]);
    expect(runtime.commitManualSnapshot).toHaveBeenCalledWith('model-1', snapshotId, { rowCount: 2, linkCount: 1 });
    const payload = (runtime.requestPopulationRun.mock.calls[0] as unknown as [{ payload: { sources: Array<Record<string, unknown>>; specification: { concepts: Array<{ identity: object }>; sourceScope: unknown[] } } }])[0].payload;
    expect(payload.sources).toEqual([expect.objectContaining({ sourceKind: 'manual', conceptId: 'c-customer', source: { workspaceId: 'ws-1', assetId: `manual:${snapshotId}`, snapshotId } })]);
    expect(payload.specification.sourceScope).toContainEqual({ workspaceId: 'ws-1', assetId: `manual:${snapshotId}` });
    expect(payload.specification.concepts[0].identity).toEqual({ namespace: 'customer', keyComponents: ['customer_id'] });
  });

  describe('data fixes', () => {
    const withCorrections = (runtime: Record<string, jest.Mock>, sequence = 3, corrections: unknown[] = []) => {
      runtime.listCorrections = jest.fn(async () => ({ modelId: 'model-1', correctionSequence: sequence, corrections }));
      runtime.recordCorrection = jest.fn(async () => ({ sequence: sequence + 1, modelId: 'model-1', state: 'accepted' }));
    };

    it('records a value fix at the current watermark and rebuilds the draft', async () => {
      const { runtime, service } = setup();
      withCorrections(runtime as any);
      const result = await service.recordCorrection('u-1', 'model-1', {
        action: 'edit_entity', targetIdentity: { entityId: 'e-1' }, payload: { attribute: 'name', value: 'Acme SA', extra: 1 },
      });
      expect((runtime as any).recordCorrection).toHaveBeenCalledWith(expect.objectContaining({
        action: 'edit_entity', targetIdentity: { entityId: 'e-1' }, payload: { attribute: 'name', value: 'Acme SA' },
        expectedCorrectionSequence: 3, modelVersionId: 'v-1', actorUserId: 'u-1',
      }));
      expect(result).toEqual({ sequence: 4, rebuild: { jobId: 'j-1', status: 'queued' } });
      // Only a whole-model build replaces the draft people explore.
      expect(runtime.requestPopulationRun).toHaveBeenCalledWith(
        expect.objectContaining({ payload: expect.objectContaining({ purpose: 'build', scope: { kind: 'model' } }) }),
        expect.any(String),
      );
    });

    it('refuses a fix that points to nothing', async () => {
      const { runtime, service } = setup();
      withCorrections(runtime as any);
      await expect(service.recordCorrection('u-1', 'model-1', { action: 'add_relationship', targetIdentity: { relationId: 'r' } }))
        .rejects.toThrow('This fix does not point to a record or link');
      await expect(service.recordCorrection('u-1', 'model-1', { action: 'edit_entity', targetIdentity: { entityId: 'e-1' } }))
        .rejects.toThrow('This fix does not point to a record or link');
    });

    it('undoes a fix by recording a revert of it', async () => {
      const { runtime, service } = setup();
      withCorrections(runtime as any, 5, [{ sequence: 2, action: 'remove_entity', targetIdentity: { entityId: 'e-1' }, payload: {} }]);
      await service.undoCorrection('u-1', 'model-1', 2);
      expect((runtime as any).recordCorrection).toHaveBeenCalledWith(expect.objectContaining({
        action: 'revert', payload: { sequence: 2 }, expectedCorrectionSequence: 5,
      }));
      await expect(service.undoCorrection('u-1', 'model-1', 9)).rejects.toThrow('This fix no longer exists');
    });

    it('changes the rebuild key when a new fix exists', async () => {
      const { runtime, service } = setup();
      await service.requestRefresh('u-1', 'model-1', { purpose: 'refresh', scope: { kind: 'model' } });
      withCorrections(runtime as any, 1);
      await service.requestRefresh('u-1', 'model-1', { purpose: 'refresh', scope: { kind: 'model' } });
      const keys = (runtime.requestPopulationRun.mock.calls as unknown as Array<[unknown, string]>).map((call) => call[1]);
      expect(keys[0]).not.toEqual(keys[1]);
    });

    it('shows who corrected a value and what the source said', async () => {
      const { runtime, service } = setup();
      runtime.getBoundRecords.mockResolvedValueOnce({
        dataRevisionId: 'dr-1',
        entities: [{ entityId: 'e-1', conceptId: 'c-customer', label: 'Acme', attributes: { name: 'Acme SA' }, provenance: {},
          origins: { name: { kind: 'human', assetId: 'manual:x', correctedBy: 'u-1', originalValue: 'Acme', correctionSequence: 4 } } }],
        relationships: [],
        counts: { entities: 1, assertions: 1, relationships: 0 },
        specification: { concepts: [{ conceptId: 'c-customer', label: 'Customer', allowedFields: ['name'] }], relations: [] },
      } as any);
      const result = await service.boundRecords('u-1', 'model-1', 25);
      expect(result.concepts[0].entities[0].provenance.name).toMatchObject({
        correction: { sequence: 4, correctedByYou: true, originalValue: 'Acme' },
      });
    });
  });
});
