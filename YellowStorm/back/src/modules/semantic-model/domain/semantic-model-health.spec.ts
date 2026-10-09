import { buildModelHealth, emptyModelHealth, type HealthBuildInput } from './semantic-model-health';
import type { RuntimeConceptHealth } from '../services/semantic-runtime-client.service';

const PARTICIPATION = 'c-participation';
const CORRESPONDENT = 'c-correspondent';
const FACT = 'c-fact';
const MESSAGE = 'c-message';

const sheet = (conceptId: string, fields: Partial<RuntimeConceptHealth>): RuntimeConceptHealth => ({
  conceptId, keyFields: [], workspaceIds: ['ws-1'], sources: [{ name: 'email.zip', sheet: 'participants', rowsAvailable: 100, rowsRead: 100 }],
  rowsAvailable: 100, rowsRead: 100, rowsKeyed: 100, recordsMade: 100, dropped: [], findings: [], ...fields,
});

/** The e-mail model of the diagnosed run: a key too coarse, and an AI sample. */
const input = (overrides: Partial<HealthBuildInput['records']> = {}): HealthBuildInput => ({
  records: {
    dataRevisionId: 'dr-1',
    specification: {
      concepts: [
        { conceptId: PARTICIPATION, label: 'Participation', allowedFields: [] },
        { conceptId: CORRESPONDENT, label: 'Correspondant', allowedFields: [] },
        { conceptId: FACT, label: 'Fait', allowedFields: [] },
        { conceptId: MESSAGE, label: 'Message e-mail', allowedFields: [] },
      ],
      relations: [{ relationId: 'r-1', label: 'écrit par' }],
    },
    conceptCounts: { [PARTICIPATION]: 3, [CORRESPONDENT]: 3, [FACT]: 471, [MESSAGE]: 25000 },
    gaps: {
      missingValues: [{ conceptId: CORRESPONDENT, attribute: 'domaine', missing: 3, total: 3 }],
      unresolvedLinks: [{ relationId: 'r-1', kind: 'unresolved_reference', count: 12 }],
      other: [
        { conceptId: PARTICIPATION, kind: 'conflicting_values', count: 295963 },
        { conceptId: PARTICIPATION, kind: 'identity_too_coarse', count: 1 },
        { conceptId: FACT, kind: 'budget_exhausted', count: 1 },
        { conceptId: FACT, kind: 'missing_identity', count: 29, fields: ['description'] },
      ],
    },
    health: {
      version: 1,
      concepts: {
        [PARTICIPATION]: sheet(PARTICIPATION, {
          keyFields: ['role'], rowsAvailable: 99900, rowsRead: 99900, rowsKeyed: 99900, recordsMade: 3,
          dropped: [{ reason: 'same_key', rows: 99897 }],
          findings: [
            { kind: 'identity_too_coarse', rows: 99900, entities: 3, keyFields: ['role'], discardedValues: 295963,
              keyCardinality: { role: 3 },
              topKeyValues: [{ values: { role: 'destinataire' }, rows: 49900 }, { values: { role: 'expediteur' }, rows: 25000 }],
              suggestedKey: { fields: ['cle_message', 'adresse', 'role'], estimatedRecords: 99900, sampleRows: 1000 },
              examples: [{ source: 'email.zip', sheet: 'participants', row: 2, values: { cle_message: 'msg_23a6e0', role: 'destinataire' } }] },
            { kind: 'conflicting_values', field: 'adresse', rows: 295963, distinctValues: 40000, values: ['a@x.fr'], examples: [] },
          ],
        }),
        [FACT]: sheet(FACT, {
          keyFields: ['description'], rowsAvailable: 25000, rowsRead: 25000, rowsKeyed: 471, recordsMade: 471,
          dropped: [{ reason: 'ai_limit', rows: 24500 }, { reason: 'missing_identity', field: 'description', rows: 29 }],
          ai: { limit: 500, rowsRead: 500, rowsLimited: 24500, rowsFailed: 0, fields: ['description'] },
          findings: [
            { kind: 'missing_identity', field: 'description', rows: 29, aiRead: true,
              examples: [{ source: 'email.zip', sheet: 'messages', row: 41, values: { corps_complet: 'Bien reçu, merci.' } }] },
            { kind: 'ai_row_limit', limit: 500, rowsRead: 500, rowsLimited: 24500, rowsFailed: 0, examples: [] },
          ],
        }),
        [MESSAGE]: sheet(MESSAGE, { keyFields: ['cle_message'], rowsAvailable: 25000, rowsRead: 25000, rowsKeyed: 25000, recordsMade: 25000 }),
      },
    },
    ...overrides,
  },
  concepts: [
    { id: PARTICIPATION, label: 'Participation', attributes: [{ key: 'role', label: 'Rôle' }, { key: 'adresse', label: 'Adresse' }, { key: 'cle_message', label: 'Clé message' }] },
    { id: CORRESPONDENT, label: 'Correspondant', attributes: [{ key: 'domaine', label: 'Domaine' }] },
    { id: FACT, label: 'Fait', attributes: [{ key: 'description', label: 'Description' }, { key: 'corps_complet', label: 'Corps complet' }] },
    { id: MESSAGE, label: 'Message e-mail', attributes: [{ key: 'cle_message', label: 'Clé message' }] },
  ],
  relations: [{ id: 'r-1', sourceConceptId: MESSAGE }],
  derived: [{ conceptId: CORRESPONDENT, sourceConceptId: PARTICIPATION }],
  sources: new Map(),
  setup: [],
});

describe('buildModelHealth', () => {
  const health = buildModelHealth(input());
  const concept = (id: string) => health.concepts.find((item) => item.conceptId === id)!;

  it('sorts concepts worst first and counts the healthy ones', () => {
    expect(health.concepts.map((item) => [item.label, item.status])).toEqual([
      ['Participation', 'blocked'], ['Correspondant', 'warning'], ['Fait', 'warning'], ['Message e-mail', 'warning']]);
    expect(health.summary).toMatchObject({ concepts: 4, healthy: 0 });
  });

  it('explains a key that is too coarse once, with the fields that would fix it and what they would give', () => {
    const [issue, ...others] = concept(PARTICIPATION).issues;
    expect(issue).toMatchObject({
      kind: 'identity_too_coarse', cause: 'design', severity: 'blocked',
      impact: { rows: 99897, of: 99900, values: 295963 },
      params: { keyFields: 'Rôle', keyValues: 3, rows: 99900, records: 3, suggested: 'Clé message + Adresse + Rôle' },
      forecast: { records: 99900, estimated: true },
      fix: { kind: 'choose_unique_field', conceptId: PARTICIPATION, suggestedFields: ['cle_message', 'adresse', 'role'] },
      breakdown: { kind: 'key_values', items: [{ label: 'destinataire', value: 49900 }, { label: 'expediteur', value: 25000 }] },
    });
    expect(issue.examples[0]).toEqual({ source: 'email.zip', sheet: 'participants', row: 2, values: { 'Clé message': 'msg_23a6e0', Rôle: 'destinataire' } });
    // "Values disagree" is this problem's symptom: no second card, no raw gap count.
    expect(others.map((item) => item.kind)).toEqual([]);
    expect(concept(PARTICIPATION).issues.some((item) => item.kind === 'values_disagree')).toBe(false);
  });

  it('tells rows the AI never read apart from rows with no value', () => {
    const kinds = concept(FACT).issues.map((item) => [item.kind, item.cause, item.severity]);
    expect(kinds).toEqual([['rows_without_key', 'values', 'warning'], ['ai_row_limit', 'limit', 'info']]);
    const limit = concept(FACT).issues.find((item) => item.kind === 'ai_row_limit')!;
    expect(limit).toMatchObject({
      impact: { rows: 24500, of: 25000 }, fix: { kind: 'raise_ai_limit', currentLimit: 500, suggestedLimit: 25000 },
      breakdown: { kind: 'ai_cost', items: [{ label: '500', value: 500, current: true }, { label: '5000', value: 5000 }, { label: '25000', value: 25000 }] },
    });
    const missing = concept(FACT).issues[0];
    expect(missing).toMatchObject({ impact: { rows: 29, of: 25000 }, params: { field: 'Description', ai: 1 } });
    expect(missing.examples[0]).toMatchObject({ sheet: 'messages', row: 41, values: { 'Corps complet': 'Bien reçu, merci.' } });
    // The run's own gap counts (24,529 "no value") are not repeated as a second card.
    expect(concept(FACT).issues).toHaveLength(2);
    expect(concept(FACT).journey).toMatchObject({ unit: 'rows', rowsRead: 25000, recordsMade: 471, ai: { read: 500, limit: 500, limited: 24500 } });
  });

  it('shows a concept made from a broken one as inherited, pointing upstream', () => {
    expect(concept(CORRESPONDENT).issues.map((item) => item.kind)).toEqual(['inherited', 'missing_values']);
    expect(concept(CORRESPONDENT).issues[0]).toMatchObject({
      severity: 'warning', upstreamConceptId: PARTICIPATION, fix: { kind: 'go_to_concept', conceptId: PARTICIPATION } });
    expect(concept(CORRESPONDENT).origin).toEqual({ kind: 'derived', sources: [], fromConceptId: PARTICIPATION });
  });

  it('gives the header one verdict and counts fixes without the inherited ones', () => {
    expect(health.verdict).toMatchObject({ conceptId: PARTICIPATION, kind: 'identity_too_coarse' });
    expect(health.summary).toMatchObject({ rowsRead: 149900, recordsKept: 25477, fixesNeeded: 3, limits: 1 });
    expect(health.dataRevisionId).toBe('dr-1');
  });

  it('keeps the rail bar honest: records made over rows read', () => {
    expect(concept(PARTICIPATION).keepRatio).toBeCloseTo(3 / 99900, 6);
    expect(concept(MESSAGE).keepRatio).toBe(1);
    expect(concept(MESSAGE).origin).toEqual({ kind: 'sheet', sources: ['email.zip › participants'] });
  });

  it('puts a link that found nothing on the concept it starts from', () => {
    const link = concept(MESSAGE).issues[0];
    expect(link).toMatchObject({ kind: 'links_unmatched', cause: 'mapping', impact: { rows: 12 }, params: { relationship: 'écrit par' },
      fix: { kind: 'check_links', relationId: 'r-1' } });
  });

  it('keeps the run gaps of a concept the run did not count, without the AI ones', () => {
    const old = buildModelHealth({
      ...input(),
      records: { ...input().records, health: null, gaps: { missingValues: [], unresolvedLinks: [], other: [
        { conceptId: FACT, kind: 'missing_identity', count: 24529, fields: ['description'] },
        { conceptId: MESSAGE, kind: 'source_unavailable', count: 2 },
        { conceptId: MESSAGE, kind: 'materialization_cap', count: 1 },
      ] } },
    });
    const rows = old.concepts.find((item) => item.conceptId === FACT)!;
    expect(rows.issues[0]).toMatchObject({ kind: 'rows_without_key', cause: 'mapping', impact: { rows: 24529 } });
    expect(rows.journey).toMatchObject({ rowsRead: null, recordsMade: 471 });
    expect(old.concepts.find((item) => item.conceptId === MESSAGE)!.issues.map((item) => [item.kind, item.cause, item.severity]))
      .toEqual([['documents_not_read', 'mapping', 'blocked'], ['reading_limit', 'limit', 'warning']]);
  });

  it('calls a model with nothing to fix healthy and has no verdict', () => {
    const clean = buildModelHealth({ ...input(), records: { ...input().records, gaps: undefined, health: null }, derived: [] });
    expect(clean.verdict).toBeNull();
    expect(clean.summary).toMatchObject({ healthy: 4, fixesNeeded: 0, limits: 0 });
  });

  it('is empty before any data was prepared', () => {
    const setup = [{ key: 'k', group: 'sources' as const, priority: 1 as const, kind: 'concept_without_source', params: {}, action: { kind: 'view_data' as const } }];
    expect(emptyModelHealth(setup)).toMatchObject({ state: 'no_data', concepts: [], setup, summary: { setupItems: 1 } });
  });
});
