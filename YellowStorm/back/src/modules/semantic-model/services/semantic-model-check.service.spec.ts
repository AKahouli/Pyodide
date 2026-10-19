import { ModelSpecificationService } from './model-specification.service';
import { SemanticModelCheckService } from './semantic-model-check.service';
import { SemanticPopulationRefreshService } from './semantic-population-refresh.service';

const NODES = [
  { id: 'c-customer', key: 'customer', label: 'Customer', attributes: [{ key: 'customer_id', label: 'Id', type: 'text' }, { key: 'name', label: 'Name', type: 'text' }] },
  { id: 'c-contract', key: 'contract', label: 'Contract', attributes: [{ key: 'contract_id', label: 'Id', type: 'text' }, { key: 'customer_ref', label: 'Customer', type: 'text' }] },
];

const mapping = (overrides: Record<string, unknown> = {}) => ({
  id: 'm-1', conceptId: 'c-customer', workspaceId: 'ws-1', documentId: 'd-1', sheetName: 'Sheet1', assetKind: 'excel_sheet',
  fieldMappings: [{ sourceField: 'customer_id', targetAttribute: 'customer_id', mode: 'direct' }, { sourceField: 'legal_name', targetAttribute: 'name', mode: 'direct' }],
  status: 'ready', identityFields: ['customer_id'], sourceEnabled: true, validatedSourceVersion: 'sha256:abc',
  updatedAt: new Date('2026-01-01T00:00:00.000Z'), ...overrides,
});

const contractMapping = (overrides: Record<string, unknown> = {}) => mapping({
  id: 'm-2', conceptId: 'c-contract', documentId: 'd-2', identityFields: ['contract_id'],
  fieldMappings: [{ sourceField: 'id', targetAttribute: 'contract_id', mode: 'direct' }], ...overrides,
});

interface Fixture {
  mappings?: unknown[];
  identity?: Record<string, string[]>;
  labels?: Record<string, string>;
  relations?: unknown[];
  relationRules?: unknown[];
  typedRecords?: string[];
}

const setup = (fixture: Fixture = {}) => {
  const fx = {
    mappings: [mapping()], identity: { 'c-customer': ['customer_id'], 'c-contract': ['contract_id'] },
    labels: { 'c-customer': 'name', 'c-contract': 'contract_id' }, relations: [], relationRules: [], typedRecords: [] as string[], ...fixture,
  };
  const database = {
    query: jest.fn(async (sql: string) => {
      if (sql.includes('FROM semantic_model.node_types')) return { rows: NODES };
      if (sql.includes('FROM semantic_model.relation_types')) return { rows: fx.relations };
      if (sql.includes('FROM semantic_model.identity_rules')) return { rows: Object.entries(fx.identity).map(([conceptId, fields]) => ({ conceptId, fields })) };
      if (sql.includes('FROM semantic_model.relation_resolution_rules')) return { rows: fx.relationRules };
      if (sql.includes('FROM semantic_model.label_fields')) return { rows: Object.entries(fx.labels).map(([conceptId, field]) => ({ conceptId, field })) };
      if (sql.includes('FROM semantic_model.workspace_links')) return { rows: [{ workspaceId: 'ws-1', role: 'origin' }] };
      if (sql.includes('FROM semantic_model.source_mappings')) return { rows: fx.mappings };
      if (sql.includes('FROM semantic_model.data_connections')) return { rows: [] };
      if (sql.includes('SELECT DISTINCT node_type_id')) return { rows: fx.typedRecords.map((nodeTypeId) => ({ nodeTypeId })) };
      throw new Error(`unexpected query: ${sql}`);
    }),
  };
  const models = { requireRole: jest.fn(async () => ({ id: 'model-1', currentDraftVersionId: 'v-1' })) };
  const documents = { findById: jest.fn(), listAllInWorkspace: jest.fn() };
  const runtime = {
    getAiExtractionIdentity: jest.fn(),
    checkModelPlan: jest.fn(async (_body: unknown) => ({ issues: [] as unknown[], errorCount: 0, warningCount: 0 })),
    mirrorSpecification: jest.fn(), appendManualRows: jest.fn(), commitManualSnapshot: jest.fn(), requestPopulationRun: jest.fn(),
  };
  const refresh = new SemanticPopulationRefreshService(
    database as never, models as never, documents as never, new ModelSpecificationService(), runtime as never,
  );
  return { database, models, documents, runtime, service: new SemanticModelCheckService(refresh, runtime as never) };
};

const codes = (check: { issues: Array<{ code: string }> }) => check.issues.map((issue) => issue.code);

describe('SemanticModelCheckService', () => {
  it('finds nothing wrong with a consistent model, and reads no file and stores nothing', async () => {
    const { service, runtime, documents } = setup();
    const check = await service.check('u-1', 'model-1');
    expect(check).toMatchObject({ modelId: 'model-1', errorCount: 0, warningCount: 0, issues: [] });
    expect(check.versionKey).toMatch(/^[0-9a-f]{16}$/);
    const body = runtime.checkModelPlan.mock.calls[0][0] as { sources: Array<Record<string, unknown>>; specification: { concepts: Array<{ conceptId: string }> } };
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0]).toMatchObject({ conceptId: 'c-customer', mappingId: 'm-1', columnMapping: { customer_id: 'customer_id', legal_name: 'name' } });
    expect(body.specification.concepts.map((concept) => concept.conceptId)).toEqual(['c-customer']);
    expect(documents.findById).not.toHaveBeenCalled();
    expect(documents.listAllInWorkspace).not.toHaveBeenCalled();
    expect(runtime.getAiExtractionIdentity).not.toHaveBeenCalled();
    for (const write of [runtime.mirrorSpecification, runtime.appendManualRows, runtime.commitManualSnapshot, runtime.requestPopulationRun]) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  it('plans a workspace mapping as one stand-in source without listing the workspace', async () => {
    const { service, runtime, documents } = setup({ mappings: [mapping({ scope: 'workspace', documentId: '' })] });
    expect((await service.check('u-1', 'model-1')).issues).toEqual([]);
    expect(documents.listAllInWorkspace).not.toHaveBeenCalled();
    expect((runtime.checkModelPlan.mock.calls[0][0] as { sources: unknown[] }).sources).toHaveLength(1);
  });

  it('lists every problem at once, errors first, each on what it concerns', async () => {
    const { service } = setup({
      mappings: [
        mapping({ identityFields: [] }),
        contractMapping({ fieldMappings: [{ sourceField: 'id', targetAttribute: 'contract_id', mode: 'direct' }, { sourceField: 'x', targetAttribute: 'gone', mode: 'direct' }] }),
      ],
      identity: { 'c-customer': [], 'c-contract': ['contract_id'] },
      labels: { 'c-contract': 'contract_id' },
    });
    const check = await service.check('u-1', 'model-1');
    expect(check.issues).toMatchObject([
      { severity: 'error', code: 'missing_label_field', conceptId: 'c-customer' },
      { severity: 'error', code: 'no_identity', conceptId: 'c-customer' },
      { severity: 'warning', code: 'mapping_attribute_missing', conceptId: 'c-contract', mappingId: 'm-2', fieldId: 'gone' },
    ]);
    expect(check).toMatchObject({ errorCount: 2, warningCount: 1 });
  });

  it('refuses a link that matches on a field no source fills, and warns about a link with no rule', async () => {
    const link = (id: string, key: string) => ({ id, key, sourceNodeTypeId: 'c-contract', targetNodeTypeId: 'c-customer', cardinality: 'many_to_one' });
    const { service } = setup({
      mappings: [mapping(), contractMapping()],
      relations: [link('r-1', 'owns'), link('r-2', 'follows')],
      relationRules: [{ relationId: 'r-1', sourceAttribute: 'customer_ref', targetAttribute: 'customer_id', strategy: 'normalized' }],
    });
    const check = await service.check('u-1', 'model-1');
    expect(check.issues).toMatchObject([
      { severity: 'error', code: 'relation_rule_unmapped', relationId: 'r-1', conceptId: 'c-contract', fieldId: 'customer_ref' },
      { severity: 'warning', code: 'relation_without_rule', relationId: 'r-2' },
    ]);
  });

  it('counts concepts that only hold typed records as filled, without storing a snapshot', async () => {
    const { service, runtime } = setup({ mappings: [], typedRecords: ['c-customer'] });
    expect((await service.check('u-1', 'model-1')).issues).toEqual([]);
    expect((runtime.checkModelPlan.mock.calls[0][0] as { sources: Array<{ sourceKind: string }> }).sources[0].sourceKind).toBe('manual');
    expect(runtime.appendManualRows).not.toHaveBeenCalled();
  });

  it('says so when there is nothing to build from', async () => {
    const { service } = setup({ mappings: [] });
    const check = await service.check('u-1', 'model-1');
    expect(codes(check)).toEqual(['no_usable_source']);
    expect(check.errorCount).toBe(1);
  });

  it('adds what the runtime found and keeps its target', async () => {
    const { service, runtime } = setup();
    runtime.checkModelPlan.mockResolvedValueOnce({
      issues: [{ severity: 'error', code: 'unmapped_filter_field', message: 'm', conceptId: 'c-customer', mappingId: 'm-1', fieldId: 'name' }], errorCount: 1, warningCount: 0,
    });
    const check = await service.check('u-1', 'model-1');
    expect(check.issues).toEqual([{ severity: 'error', code: 'unmapped_filter_field', message: 'm', conceptId: 'c-customer', mappingId: 'm-1', fieldId: 'name' }]);
    expect(check.errorCount).toBe(1);
  });

  it('answers an unchanged model from its cache and a changed mapping with a new check', async () => {
    const { service, runtime, models } = setup();
    const first = await service.check('u-1', 'model-1');
    expect(await service.check('u-2', 'model-1')).toBe(first);
    expect(runtime.checkModelPlan).toHaveBeenCalledTimes(1);
    expect(models.requireRole).toHaveBeenCalledTimes(2);
    const changed = setup({ mappings: [mapping({ updatedAt: new Date('2026-02-01T00:00:00.000Z') })] });
    const again = await changed.service.check('u-1', 'model-1');
    expect(again.versionKey).not.toBe(first.versionKey);
  });

  it('warns that the runtime rules are unchecked when it cannot be reached, and asks again next time', async () => {
    const { service, runtime } = setup();
    runtime.checkModelPlan.mockRejectedValueOnce(new Error('down'));
    const check = await service.check('u-1', 'model-1');
    expect(check).toMatchObject({ errorCount: 0, warningCount: 1 });
    expect(check.issues[0]).toMatchObject({ severity: 'warning', code: 'runtime_unavailable' });
    expect((await service.check('u-1', 'model-1')).issues).toEqual([]);
    expect(runtime.checkModelPlan).toHaveBeenCalledTimes(2);
  });

  it('checks on a reader permission only', async () => {
    const { service, models } = setup();
    await service.check('u-1', 'model-1');
    expect(models.requireRole).toHaveBeenCalledWith('u-1', 'model-1', ['owner', 'editor', 'viewer']);
  });
});
