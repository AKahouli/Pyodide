import {
  normalizeRelationValue,
  reconcileConceptEntities,
  reconcilePreviewEntities,
  resolveRelationMatches,
  type ReconciledEntity,
  type ResolvedMappingEntity,
} from '../domain/semantic-cross-source.types';
import { SemanticCrossSourceService } from './semantic-cross-source.service';

const mapped = (
  mappingId: string,
  values: Record<string, unknown>,
  identityFields = ['id'],
): ResolvedMappingEntity => ({
  conceptId: 'organization',
  mappingId,
  identityFields,
  source: { kind: 'csv', documentName: `${mappingId}.csv` },
  entity: { entityKey: String(values.id ?? mappingId), label: String(values.name ?? values.id ?? mappingId), values, provenance: {} },
});

const entity = (id: string, conceptId: string, values: Record<string, unknown>): ReconciledEntity => ({
  id,
  conceptId,
  entityKey: id,
  label: id,
  values,
  provenance: {},
  sources: [],
  conflicts: [],
});

describe('cross-source resolution domain', () => {
  it('uses the primary source and fills missing fields from fallback sources', () => {
    const entities = reconcileConceptEntities([
      mapped('excel', { id: 'C001', name: 'Sony Europe', country: 'NL' }),
      mapped('crm', { id: 'C001', name: 'Sony Europe B.V.', country: null }),
    ], {
      conceptId: 'organization',
      priorities: [{ mappingId: 'crm', rank: 1 }, { mappingId: 'excel', rank: 2 }],
      defaultStrategy: 'primary_then_fallback',
    });

    expect(entities).toHaveLength(1);
    expect(entities[0].values).toEqual({ id: 'C001', name: 'Sony Europe B.V.', country: 'NL' });
    expect(entities[0].provenance.name.mappingId).toBe('crm');
    expect(entities[0].provenance.country.mappingId).toBe('excel');
    expect(entities[0].conflicts).toEqual([expect.objectContaining({ attribute: 'name', preferredMappingId: 'crm', conflictingMappingId: 'excel' })]);
  });

  it('does not merge rows without a populated identity', () => {
    const entities = reconcileConceptEntities([
      mapped('one', { name: 'Sony' }, ['id']),
      mapped('two', { name: 'Sony' }, ['id']),
    ]);
    expect(entities).toHaveLength(2);
  });

  it('normalizes capitalization, accents, punctuation and ampersands deterministically', () => {
    expect(normalizeRelationValue('  Société A & B, S.A. ', 'normalized')).toBe('societe a and b s a');
    expect(normalizeRelationValue(' C001 ', 'exact')).toBe('C001');
    expect(normalizeRelationValue(' C001 ', 'case_insensitive')).toBe('c001');
  });

  it('resolves an exact relationship match', () => {
    const matches = resolveRelationMatches([
      entity('contract', 'contract-concept', { customerId: 'C001' }),
      entity('organization', 'organization-concept', { id: 'C001' }),
    ], {
      id: 'rule', relationId: 'relation', sourceConceptId: 'contract-concept', targetConceptId: 'organization-concept',
       sourceAttribute: 'customerId', targetAttribute: 'id', cardinality: 'many_to_one', strategy: 'exact', ambiguityPolicy: 'review',
    });
    expect(matches).toEqual([expect.objectContaining({ sourceEntityId: 'contract', targetEntityIds: ['organization'], status: 'resolved' })]);
  });

  it('never auto-selects when more than one target matches', () => {
    const matches = resolveRelationMatches([
      entity('contract', 'contract-concept', { counterparty: 'sony' }),
      entity('sony-europe', 'organization-concept', { name: 'Sony' }),
      entity('sony-france', 'organization-concept', { name: 'SONY' }),
    ], {
      id: 'rule', relationId: 'relation', sourceConceptId: 'contract-concept', targetConceptId: 'organization-concept',
       sourceAttribute: 'counterparty', targetAttribute: 'name', cardinality: 'many_to_one', strategy: 'case_insensitive', ambiguityPolicy: 'review',
    });
    expect(matches[0]).toMatchObject({ status: 'ambiguous', targetEntityIds: ['sony-europe', 'sony-france'] });
  });

  it('does not claim a unique match when the target sample is incomplete', () => {
    const matches = resolveRelationMatches([
      entity('contract', 'contract-concept', { customerId: 'C001' }),
      entity('organization', 'organization-concept', { id: 'C001' }),
    ], {
      id: 'rule', relationId: 'relation', sourceConceptId: 'contract-concept', targetConceptId: 'organization-concept',
       sourceAttribute: 'customerId', targetAttribute: 'id', cardinality: 'many_to_one', strategy: 'exact', ambiguityPolicy: 'review',
    }, new Set(['organization-concept']));

    expect(matches[0]).toMatchObject({ status: 'unresolved', partial: true, targetEntityIds: ['organization'] });
  });

  it('resolves all valid targets for a one-to-many relationship', () => {
    const matches = resolveRelationMatches([
      entity('contract', 'contract-concept', { id: 'C-001' }),
      entity('amendment-1', 'amendment-concept', { contractId: 'C-001', number: 1 }),
      entity('amendment-2', 'amendment-concept', { contractId: 'C-001', number: 2 }),
      entity('amendment-3', 'amendment-concept', { contractId: 'C-001', number: 3 }),
      entity('amendment-4', 'amendment-concept', { contractId: 'C-001', number: 4 }),
      entity('amendment-5', 'amendment-concept', { contractId: 'C-001', number: 5 }),
    ], {
      id: 'rule', relationId: 'relation', sourceConceptId: 'contract-concept', targetConceptId: 'amendment-concept',
      sourceAttribute: 'id', targetAttribute: 'contractId', cardinality: 'one_to_many', strategy: 'exact', ambiguityPolicy: 'review',
    });

    expect(matches[0]).toMatchObject({ status: 'resolved', targetEntityIds: ['amendment-1', 'amendment-2', 'amendment-3', 'amendment-4', 'amendment-5'] });
  });

  it('marks a concept incomplete when complete sources overflow the displayed sample together', () => {
    const entries = Array.from({ length: 40 }, (_, index) => mapped(
      index < 20 ? 'crm' : 'excel',
      { id: `C${String(index + 1).padStart(3, '0')}` },
    ));

    const result = reconcilePreviewEntities(entries, [], 25);

    expect(result.entities).toHaveLength(25);
    expect(result.incompleteConceptIds).toEqual(['organization']);
  });
});

describe('SemanticCrossSourceService boundaries', () => {
  const buildService = () => {
    const database = { query: jest.fn(), transaction: jest.fn() };
    const models = {
      requireActiveRole: jest.fn().mockResolvedValue({ id: 'model', currentDraftVersionId: 'version', role: 'editor' }),
      requireRole: jest.fn(),
      advanceRevision: jest.fn(),
      audit: jest.fn(),
    };
    const sourceMappings = { resolveConfigured: jest.fn() };
    return {
      service: new SemanticCrossSourceService(database as never, models as never, sourceMappings as never),
      database,
      models,
      sourceMappings,
    };
  };

  it('rejects matching fields outside the relationship endpoint concepts', async () => {
    const { service, database } = buildService();
    database.query.mockResolvedValue({ rows: [{
      relationId: 'relation', sourceAttributes: [{ key: 'id' }], targetAttributes: [{ key: 'contractId' }],
    }] });

    await expect(service.saveRule('user', 'model', {
      expectedRevision: 1,
      relationId: 'relation',
      sourceAttribute: 'unknown',
      targetAttribute: 'contractId',
      strategy: 'exact',
      ambiguityPolicy: 'review',
    })).rejects.toThrow('endpoint concepts');
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('requires source priority to rank every concept mapping exactly once', async () => {
    const { service, database } = buildService();
    database.query
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ id: 'mapping-one' }, { id: 'mapping-two' }] });

    await expect(service.savePolicy('user', 'model', 'concept', {
      expectedRevision: 1,
      priorities: [{ mappingId: 'mapping-one', rank: 1 }],
      defaultStrategy: 'primary_then_fallback',
    })).rejects.toThrow('rank every mapping');
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('lets viewers inspect conflicts without writing review items', async () => {
    const { service, database, models, sourceMappings } = buildService();
    models.requireActiveRole.mockResolvedValue({ id: 'model', currentDraftVersionId: 'version', role: 'viewer' });
    sourceMappings.resolveConfigured.mockResolvedValue({
      issues: [],
      incompleteConceptIds: [],
      entities: [mapped('primary', { id: 'C001', country: 'NL' }), mapped('fallback', { id: 'C001', country: 'FR' })],
    });
    database.query.mockImplementation((sql: string) => {
      if (sql.includes('source_resolution_policies')) return Promise.resolve({ rows: [{ conceptId: 'organization', priorities: [{ mappingId: 'primary', rank: 1 }, { mappingId: 'fallback', rank: 2 }], defaultStrategy: 'primary_then_fallback' }] });
      if (sql.includes('relation_resolution_rules')) return Promise.resolve({ rows: [] });
      if (sql.includes('node_types node')) return Promise.resolve({ rows: [{ id: 'organization', label: 'Organization' }] });
      return Promise.resolve({ rows: [] });
    });

    await expect(service.dataPreview('viewer', 'model', { limit: 25 })).resolves.toMatchObject({ summary: { conflicts: 1 } });
    expect(database.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO semantic_model.review_items'))).toBe(false);
  });

  it('keeps relation matches partial when a disconnected target source makes the target concept incomplete', async () => {
    const { service, database, sourceMappings } = buildService();
    sourceMappings.resolveConfigured.mockResolvedValue({
      issues: [{ mappingId: 'disabled-target', code: 'source_unavailable', message: 'The mapped source is not available.' }],
      incompleteConceptIds: ['organization-concept'],
      entities: [
        { ...mapped('contracts', { id: 'contract', customerId: 'C001' }), conceptId: 'contract-concept' },
        { ...mapped('organizations', { id: 'C001' }), conceptId: 'organization-concept' },
      ],
    });
    database.query.mockImplementation((sql: string) => {
      if (sql.includes('relation_resolution_rules')) return Promise.resolve({ rows: [{
        id: 'rule', relationId: 'relation', relationLabel: 'Customer',
        sourceConceptId: 'contract-concept', sourceConceptLabel: 'Contract',
        targetConceptId: 'organization-concept', targetConceptLabel: 'Organization',
         sourceAttribute: 'customerId', targetAttribute: 'id', cardinality: 'many_to_one', strategy: 'exact', ambiguityPolicy: 'review',
      }] });
      if (sql.includes('source_resolution_policies')) return Promise.resolve({ rows: [] });
      if (sql.includes('node_types node')) return Promise.resolve({ rows: [
        { id: 'contract-concept', label: 'Contract' }, { id: 'organization-concept', label: 'Organization' },
      ] });
      return Promise.resolve({ rows: [] });
    });

    await expect(service.previewRule('editor', 'model', 'rule')).resolves.toMatchObject({
      matches: [{ status: 'unresolved', partial: true }],
      sourceIssues: [{ mappingId: 'disabled-target', code: 'source_unavailable' }],
    });
  });

  it('honors an accepted ambiguous relationship decision in later previews', async () => {
    const { service, database, sourceMappings } = buildService();
    sourceMappings.resolveConfigured.mockResolvedValue({
      issues: [], incompleteConceptIds: [], entities: [
        { ...mapped('contracts', { id: 'contract', customer: 'Sony' }), conceptId: 'contract-concept' },
        { ...mapped('sony-eu', { id: 'sony-eu', name: 'Sony' }), conceptId: 'organization-concept' },
        { ...mapped('sony-fr', { id: 'sony-fr', name: 'SONY' }), conceptId: 'organization-concept' },
      ],
    });
    database.query.mockImplementation((sql: string) => {
      if (sql.includes("resolution->>'decision'='accepted'")) return Promise.resolve({ rows: [{
        kind: 'ambiguous_relation', targetId: 'relation', details: { sourceEntityId: 'contract-concept:identity:contract' },
        resolution: { decision: 'accepted', selectedTargetId: 'organization-concept:identity:sony-fr' },
      }] });
      if (sql.includes('relation_resolution_rules')) return Promise.resolve({ rows: [{
        id: 'rule', relationId: 'relation', relationLabel: 'Customer',
        sourceConceptId: 'contract-concept', sourceConceptLabel: 'Contract',
        targetConceptId: 'organization-concept', targetConceptLabel: 'Organization',
         sourceAttribute: 'customer', targetAttribute: 'name', cardinality: 'many_to_one', strategy: 'case_insensitive', ambiguityPolicy: 'review',
      }] });
      if (sql.includes('source_resolution_policies')) return Promise.resolve({ rows: [] });
      if (sql.includes('node_types node')) return Promise.resolve({ rows: [
        { id: 'contract-concept', label: 'Contract' }, { id: 'organization-concept', label: 'Organization' },
      ] });
      return Promise.resolve({ rows: [] });
    });

    await expect(service.dataPreview('editor', 'model', { limit: 25 })).resolves.toMatchObject({
      relations: [{ status: 'resolved', targetEntityIds: ['organization-concept:identity:sony-fr'] }],
      summary: { resolvedRelations: 1, ambiguousRelations: 0 },
    });
  });

  it('uses one canonical review fingerprint in rule and data previews', async () => {
    const { service, database, sourceMappings } = buildService();
    sourceMappings.resolveConfigured.mockResolvedValue({
      issues: [], incompleteConceptIds: [], entities: [
        { ...mapped('contracts', { id: 'contract', customer: 'Sony' }), conceptId: 'contract-concept' },
        { ...mapped('sony-eu', { id: 'sony-eu', name: 'Sony' }), conceptId: 'organization-concept' },
        { ...mapped('sony-fr', { id: 'sony-fr', name: 'SONY' }), conceptId: 'organization-concept' },
      ],
    });
    database.query.mockImplementation((sql: string) => {
      if (sql.includes("resolution->>'decision'='accepted'")) return Promise.resolve({ rows: [] });
      if (sql.includes('relation_resolution_rules')) return Promise.resolve({ rows: [{
        id: 'rule', relationId: 'relation', relationLabel: 'Customer', sourceConceptId: 'contract-concept',
        sourceConceptLabel: 'Contract', targetConceptId: 'organization-concept', targetConceptLabel: 'Organization',
         sourceAttribute: 'customer', targetAttribute: 'name', cardinality: 'many_to_one', strategy: 'case_insensitive', ambiguityPolicy: 'review',
      }] });
      if (sql.includes('source_resolution_policies')) return Promise.resolve({ rows: [] });
      if (sql.includes('node_types node')) return Promise.resolve({ rows: [
        { id: 'contract-concept', label: 'Contract' }, { id: 'organization-concept', label: 'Organization' },
      ] });
      return Promise.resolve({ rows: [] });
    });

    await service.dataPreview('editor', 'model', { limit: 25 });
    await service.previewRule('editor', 'model', 'rule', 25);
    const fingerprints = database.query.mock.calls
      .filter(([sql]) => String(sql).includes('INSERT INTO semantic_model.review_items'))
      .map(([, params]) => params[3]);
    expect(fingerprints).toHaveLength(2);
    expect(fingerprints[0]).toBe(fingerprints[1]);
  });

  it('applies only the accepted source pair and preserves its provenance', async () => {
    const { service, database, sourceMappings } = buildService();
    const primary = mapped('primary', { id: 'C001', country: 'NL' });
    const accepted = mapped('accepted', { id: 'C001', country: 'FR' });
    const remaining = mapped('remaining', { id: 'C001', country: 'BE' });
    accepted.entity.provenance = { rowNumber: 22 };
    sourceMappings.resolveConfigured.mockResolvedValue({ issues: [], incompleteConceptIds: [], entities: [primary, accepted, remaining] });
    database.query.mockImplementation((sql: string) => {
      if (sql.includes("resolution->>'decision'='accepted'")) return Promise.resolve({ rows: [{
        kind: 'source_conflict', targetId: 'organization:identity:c001',
        details: { attribute: 'country', preferredMappingId: 'primary', conflictingMappingId: 'accepted' },
        resolution: { decision: 'accepted', selectedMappingId: 'accepted' },
      }] });
      if (sql.includes('node_types node')) return Promise.resolve({ rows: [{ id: 'organization', label: 'Organization' }] });
      return Promise.resolve({ rows: [] });
    });

    const result = await service.dataPreview('editor', 'model', { limit: 25 });
    expect(result.concepts[0].entities[0]).toMatchObject({
      values: { country: 'FR' },
      provenance: { country: { mappingId: 'accepted', rowNumber: 22 } },
      conflicts: [{ conflictingMappingId: 'remaining' }],
    });
  });
});
