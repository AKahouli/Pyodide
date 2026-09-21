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
      throw new Error(`unexpected query: ${sql}`);
    }),
  };
  const models = {
    requireActiveRole: jest.fn(async () => ({ id: 'model-1', currentDraftVersionId: 'v-1' })),
  };
  const documents = {
    findById: jest.fn(async () => ({
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', originalName: 'a.xlsx',
      contentHash: 'sha256:abc', updatedAt: '2026-01-01', size: 100,
    })),
  };
  const runtime = {
    mirrorSpecification: jest.fn(async () => ({ reused: false })),
    requestPopulationRun: jest.fn(async () => ({ jobId: 'j-1', status: 'queued', reused: false })),
  };
  const service = new SemanticPopulationRefreshService(
    database as any, models as any, documents as any,
    new ModelSpecificationService(), runtime as any,
  );
  return { database, models, documents, runtime, service };
};

describe('SemanticPopulationRefreshService', () => {
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

  it('rejects document mappings in single scope and skips them in whole-model scope', async () => {
    const doc = MAPPING({ id: 'm-doc', assetKind: 'document' });
    const single = setup([doc]);
    await expect(single.service.requestRefresh('u-1', 'model-1', {
      purpose: 'build', scope: { kind: 'mapping', mappingId: 'm-doc' },
    })).rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED });

    const whole = setup([MAPPING(), doc]);
    const result = await whole.service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } });
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].mappingId).toBe('m-doc');
    expect(whole.runtime.mirrorSpecification).toHaveBeenCalledWith(expect.objectContaining({
      specification: expect.objectContaining({ sourceScope: [{ workspaceId: 'ws-1', assetId: 'd-1' }] }),
    }));
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
      contentHash: 'sha256:new', updatedAt: '2026-01-02', size: 100,
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
    expect(calls[0][0].payload.relationBindings).toEqual([{ relationId: 'r-1', referenceField: 'customer_ref' }]);
    rule.sourceAttribute = 'contract_id';
    await service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } });
    expect(calls[1][1]).not.toBe(calls[0][1]);
  });

  it('caps whole-model refreshes at 25 structured sources', async () => {
    const mappings = Array.from({ length: 26 }, (_, index) => MAPPING({ id: `m-${index}`, documentId: `d-${index}` }));
    const { service } = setup(mappings);
    await expect(service.requestRefresh('u-1', 'model-1', { purpose: 'build', scope: { kind: 'model' } }))
      .rejects.toMatchObject({ code: ErrorCode.SEMANTIC_MODEL_VALIDATION_FAILED });
  });
});
