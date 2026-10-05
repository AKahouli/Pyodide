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
    return { service: new SemanticDerivedSourceService(database as never, models as never), client, models };
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
});
