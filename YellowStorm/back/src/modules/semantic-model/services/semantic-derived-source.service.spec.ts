import { SemanticDerivedSourceService } from './semantic-derived-source.service';
import type { DerivedSource } from '../domain/semantic-derived-source.types';

const attribute = (key: string) => ({ key, label: key.replaceAll('_', ' '), type: 'text' as const, required: false });
const nodes = [
  { id: 'org', label: 'Organization', attributes: ['id', 'name', 'country'].map(attribute) },
  { id: 'contract', label: 'Contract', attributes: ['contract_number', 'customer_id', 'customer_name', 'effective_date'].map(attribute) },
  { id: 'site', label: 'Site', attributes: ['code'].map(attribute) },
];
const derived = (overrides: Partial<DerivedSource> = {}): DerivedSource => ({
  id: 'd-1', conceptId: 'org', sourceConceptId: 'contract', conflictRule: 'most_frequent', orderBy: null, updatedAt: '2026-09-30T00:00:00.000Z',
  fieldMappings: [{ sourceAttribute: 'customer_id', targetAttribute: 'id' }, { sourceAttribute: 'customer_name', targetAttribute: 'name' }],
  ...overrides,
});

describe('SemanticDerivedSourceService', () => {
  const setup = (existing: DerivedSource[] = []) => {
    const client = { query: jest.fn(async (sql: string, _params: unknown[] = []) => sql.includes('RETURNING')
      ? { rows: [{ ...derived(), updatedAt: new Date('2026-09-30T00:00:00.000Z') }] } : { rows: [] }) };
    const database = {
      query: jest.fn(async (sql: string) => sql.includes('FROM semantic_model.derived_sources')
        ? { rows: existing } : { rows: nodes.filter((node) => node.id !== 'site') }),
      transaction: jest.fn(async (work: (client: unknown) => unknown) => work(client)),
    };
    const models = {
      requireActiveRole: jest.fn(async () => ({ id: 'model', currentDraftVersionId: 'v-1' })),
      advanceRevision: jest.fn(async () => 7),
      audit: jest.fn(async () => undefined),
    };
    const runtime = { previewSheetFields: jest.fn(async () => ({
      rows: [{ rowNumber: 1, fields: { country: { method: 'rules', reason: 'found', value: 'France', column: 'notes', span: { start: 6, end: 12 } } } }],
      ai: { aiRows: 0, aiCalls: 0, aiSkippedRows: 0, aiFailedRows: 0 },
    })) };
    const agent = { resolveAgent: jest.fn(async () => ({ slug: 'extractor', llmModel: 'm' })) };
    const settings = { getDefaults: jest.fn(async () => ({ configured: { maxBlocks: 50 } })) };
    return {
      service: new SemanticDerivedSourceService(database as never, models as never, runtime as never, agent as never, settings as never),
      client, models, runtime, database,
    };
  };
  const dto = (overrides: Record<string, unknown> = {}) => ({
    expectedRevision: 6, conceptId: 'org', sourceConceptId: 'contract', identityFields: ['id'], conflictRule: 'most_frequent' as const,
    fieldMappings: derived().fieldMappings, ...overrides,
  });

  it('saves the derivation and makes its key fields the concept identity', async () => {
    const { service, client, models } = setup();
    const result = await service.save('user', 'model', dto({ orderBy: 'effective_date' }));
    expect(result).toMatchObject({ revision: 7, derivedSource: { id: 'd-1', updatedAt: '2026-09-30T00:00:00.000Z' } });
    const insert = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO semantic_model.derived_sources'))!;
    // The order field only matters to the most recent rule, so it is not kept for another rule.
    expect(insert[1]).toEqual(['model', 'org', 'contract', JSON.stringify(derived().fieldMappings), 'most_frequent', null, 'user']);
    expect(client.query.mock.calls.some(([sql, params]) => String(sql).includes('identity_rules') && params?.[2] === '["id"]')).toBe(true);
    expect(models.audit).toHaveBeenCalledWith(client, 'model', 'v-1', 'user', 'derived_source.saved', expect.objectContaining({ conceptId: 'org' }));
  });

  it.each([
    ['a key field that is not filled', dto({ identityFields: ['country'] }), 'The key field country must be filled from Contract'],
    ['the most recent rule without a date', dto({ conflictRule: 'latest' }), 'Choose the field that tells which record is the most recent'],
    ['a field the source does not have', dto({ fieldMappings: [{ sourceAttribute: 'nope', targetAttribute: 'id' }] }), 'Contract has no field nope'],
    ['a concept made from itself', dto({ sourceConceptId: 'org' }), 'A concept cannot be made from its own records'],
  ])('refuses %s', async (_name, input, message) => {
    const { service } = setup();
    await expect(service.save('user', 'model', input)).rejects.toThrow(message);
  });

  it('never chains derivations', async () => {
    await expect(setup([derived({ id: 'd-2', conceptId: 'contract', sourceConceptId: 'site' })]).service.save('user', 'model', dto()))
      .rejects.toThrow('Contract is itself made from another concept');
    await expect(setup([derived({ id: 'd-2', conceptId: 'site', sourceConceptId: 'org' })]).service.save('user', 'model', dto()))
      .rejects.toThrow('Organization already fills another concept');
  });

  it('sends a run only the derivations it can make, in a stable order and shape', () => {
    const { service } = setup();
    const runtime = service.runtimeDerivations(
      [derived({ id: 'd-2', conflictRule: 'latest', orderBy: 'effective_date' }), derived({ id: 'd-1' }), derived({ id: 'd-3', sourceConceptId: 'site' })],
      nodes, new Set(['contract']), new Map([['org', ['id']]]));
    expect(runtime.map((item) => item.derivationId)).toEqual(['d-1', 'd-2']);
    expect(runtime[1]).toEqual({
      derivationId: 'd-2', conceptId: 'org', sourceConceptId: 'contract', fieldMappings: derived().fieldMappings,
      conflictRule: 'latest', orderBy: 'effective_date', labelField: 'name', mappingVersion: '2026-09-30T00:00:00.000Z',
    });
  });

  it('leaves out a derivation whose key or date field was removed, and stops copying a removed field', () => {
    const { service } = setup();
    const trimmed = nodes.map((node) => node.id === 'contract' ? { ...node, attributes: ['contract_number', 'customer_id', 'date'].map(attribute) } : node);
    const runtime = service.runtimeDerivations(
      [derived({ id: 'd-1' }), derived({ id: 'd-2', conflictRule: 'latest', orderBy: 'effective_date' })],
      trimmed, new Set(['contract']), new Map([['org', ['id']]]));
    expect(runtime.map((item) => item.derivationId)).toEqual(['d-1']);
    expect(runtime[0]).toMatchObject({ fieldMappings: [{ sourceAttribute: 'customer_id', targetAttribute: 'id' }], labelField: null });
  });

  describe('fields filled like a sheet field', () => {
    const withNotes = nodes.map((node) => node.id === 'contract' ? { ...node, attributes: [...node.attributes, attribute('notes')] } : node);
    const setupNotes = () => {
      const result = setup();
      result.database.query.mockImplementation(async (sql: string) => sql.includes('FROM semantic_model.derived_sources')
        ? { rows: [] } : { rows: withNotes.filter((node) => node.id !== 'site') });
      return result;
    };
    const country = { sourceAttribute: 'notes', targetAttribute: 'country', mode: 'extract' as const, extractionStrategy: 'rules_then_ai' as const,
      rules: { labels: ['Pays'] }, semanticDefinition: 'The country', agentId: 'reader' };
    const insertedFields = (client: { query: jest.Mock }) => JSON.parse(client.query.mock.calls
      .find(([sql]) => String(sql).includes('INSERT INTO semantic_model.derived_sources'))![1][3] as string);

    it('stores each mode with only what it uses, and a copied field as before', async () => {
      const { service, client } = setupNotes();
      await service.save('user', 'model', dto({ fieldMappings: [
        ...derived().fieldMappings.map((field) => ({ ...field, mode: 'direct' })),
        { ...country, constantValue: 'ignored' },
      ] }));
      expect(insertedFields(client)).toEqual([...derived().fieldMappings, {
        sourceAttribute: 'notes', targetAttribute: 'country', mode: 'extract', extractionStrategy: 'rules_then_ai',
        rules: { labels: ['Pays'] }, semanticDefinition: 'The country', agentId: 'reader' }]);
    });

    it('stores a recipe on a source field and a fixed value', async () => {
      const { service, client } = setupNotes();
      const recipe = { input: { kind: 'column' as const, name: 'customer_name' }, method: 'whole' as const, transform: 'upper' as const };
      await service.save('user', 'model', dto({ fieldMappings: [derived().fieldMappings[0],
        { targetAttribute: 'name', mode: 'computed', computed: recipe },
        { targetAttribute: 'country', mode: 'constant', constantValue: 'FR' }] }));
      expect(insertedFields(client)).toEqual([derived().fieldMappings[0],
        { targetAttribute: 'name', mode: 'computed', computed: recipe }, { targetAttribute: 'country', mode: 'constant', constantValue: 'FR' }]);
    });

    it.each([
      ['a text read without its source field', { targetAttribute: 'country', mode: 'extract' }, 'country: choose the Contract field it is read from'],
      ['a recipe on a field the source does not have', { targetAttribute: 'country', mode: 'computed', computed: { input: { kind: 'column', name: 'nope' }, method: 'whole' } }, 'Contract has no field nope'],
      ['a recipe without one', { targetAttribute: 'country', mode: 'computed' }, 'country: a field taken from another field needs a recipe'],
      ['rules a field text cannot use', { ...country, rules: { location: 'table', labels: ['Pays'] } }, 'country: a cell has no pages, headings or tables'],
      ['a fixed value without a value', { targetAttribute: 'country', mode: 'constant' }, 'country: a fixed value needs a value'],
    ])('refuses %s', async (_name, field, message) => {
      const { service } = setupNotes();
      await expect(service.save('user', 'model', dto({ fieldMappings: [...derived().fieldMappings, field] }))).rejects.toThrow(message);
    });

    it('sends a run the reading settings only for fields that use them, and AI limits only with AI', () => {
      const { service } = setup();
      const target = withNotes.map((node) => node.id === 'org'
        ? { ...node, attributes: node.attributes.map((item) => item.key === 'country' ? { ...item, label: 'Country', description: 'Where it is' } : item) } : node);
      const limits = { maxBlocks: 50, maxCharacters: 1000, longDocumentCharacters: 500, blocksPerField: 4 };
      const [withAi, rulesOnly] = service.runtimeDerivations([
        derived({ id: 'd-1', fieldMappings: [...derived().fieldMappings, country] }),
        derived({ id: 'd-2', fieldMappings: [...derived().fieldMappings, { sourceAttribute: 'notes', targetAttribute: 'country', mode: 'extract', extractionStrategy: 'deterministic', rules: { labels: ['Pays'] } }] }),
      ], target, new Set(['contract']), new Map([['org', ['id']]]), limits);
      expect(withAi.fieldMappings[2]).toEqual({ sourceAttribute: 'notes', targetAttribute: 'country', mode: 'extract', label: 'Country',
        extractionStrategy: 'rules_then_ai', rules: { labels: ['Pays'] }, agentId: 'reader', description: 'The country', valueType: 'text' });
      expect(withAi.aiSettings).toEqual(limits);
      expect(rulesOnly.fieldMappings[2]).toEqual({ sourceAttribute: 'notes', targetAttribute: 'country', mode: 'extract', label: 'Country',
        extractionStrategy: 'deterministic', rules: { labels: ['Pays'] } });
      expect(rulesOnly).not.toHaveProperty('aiSettings');
      // A derivation saved before the field modes is sent exactly as before, AI limits or not.
      const [old] = service.runtimeDerivations([derived()], target, new Set(['contract']), new Map([['org', ['id']]]), limits);
      expect(old).toEqual({ derivationId: 'd-1', conceptId: 'org', sourceConceptId: 'contract', fieldMappings: derived().fieldMappings,
        conflictRule: 'most_frequent', orderBy: null, labelField: 'name', mappingVersion: '2026-09-30T00:00:00.000Z' });
    });

    it('stops reading a field whose source field was removed, and a recipe taken from it', () => {
      const { service } = setup();
      const fromCountry = { targetAttribute: 'name', mode: 'computed' as const, computed: { input: { kind: 'field' as const, name: 'country' }, method: 'whole' as const } };
      const [runtime] = service.runtimeDerivations([derived({ fieldMappings: [derived().fieldMappings[0], country, fromCountry] })],
        nodes, new Set(['contract']), new Map([['org', ['id']]]));
      expect(runtime.fieldMappings).toEqual([derived().fieldMappings[0]]);
    });

    it('previews the fields on sample records with the sheet readers, record by record', async () => {
      const { service, runtime } = setupNotes();
      const result = await service.previewFields('user', 'model', {
        conceptId: 'org', sourceConceptId: 'contract', fieldMappings: [...derived().fieldMappings, country],
        records: [{ entityId: 'contract:k1', values: { customer_id: 'C-1', notes: 'Pays: France' } }],
      });
      const request = (runtime.previewSheetFields.mock.calls[0] as unknown[])[0] as { entry: Record<string, unknown>; rows: unknown[]; aiExtraction: unknown };
      expect(request.entry).toMatchObject({ conceptId: 'org', unit: 'record', source: { assetId: 'derived:contract', originalName: 'Contract' },
        options: { aiSettings: expect.objectContaining({ maxBlocks: 50 }) } });
      expect(request.entry.fieldMappings).toEqual([
        { sourceField: 'customer_id', targetAttribute: 'id', mode: 'direct' },
        { sourceField: 'customer_name', targetAttribute: 'name', mode: 'direct' },
        { sourceField: 'notes', targetAttribute: 'country', mode: 'extract', label: 'country', extractionStrategy: 'rules_then_ai',
          rules: { labels: ['Pays'] }, agentId: 'reader', description: 'The country', valueType: 'text' },
      ]);
      expect(request.rows).toEqual([{ rowNumber: 1, values: { customer_id: 'C-1', notes: 'Pays: France' } }]);
      expect(request.aiExtraction).toEqual({ agentSlug: 'extractor', model: 'm', contractVersion: 'ai-attribute-v1' });
      expect(result.records).toEqual([{ entityId: 'contract:k1', fields: { country: expect.objectContaining({ value: 'France', column: 'notes' }) } }]);
    });
  });
});
