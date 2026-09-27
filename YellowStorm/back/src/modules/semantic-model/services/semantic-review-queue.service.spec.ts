import { SemanticReviewQueueService } from './semantic-review-queue.service';

describe('SemanticReviewQueueService', () => {
  const setup = (options: { runtimeDown?: boolean } = {}) => {
    const database = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('FROM semantic_model.review_items')) {
          return { rows: [
            { id: 'rev-1', kind: 'ambiguous_relation', targetId: 'rel-1', label: 'holds',
              details: { sourceLabel: 'Acme', targetEntityIds: ['e-1', 'e-2'], targetLabels: ['Contract A', 'Contract B'] } },
            { id: 'rev-2', kind: 'source_conflict', targetId: 'c-1', label: 'Customer',
              details: { attribute: 'city', preferredMappingId: 'm-1', conflictingMappingId: 'm-2', entityLabel: 'Acme' } },
          ] };
        }
        if (sql.includes('FROM semantic_model.source_mappings m')) return { rows: [{ id: 'm-1', name: 'crm.csv' }, { id: 'm-2', name: 'customers.xlsx' }] };
        if (sql.includes('identity_rules')) return { rows: [{ id: 'c-2', label: 'Invoice' }] };
        if (sql.includes('relation_resolution_rules')) return { rows: [{ id: 'rel-2', label: 'bills', source: 'Invoice', target: 'Customer' }] };
        if (sql.includes('n.attributes')) return { rows: [{ id: 'c-1', attributes: [{ key: 'city', label: 'City' }] }] };
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const models = { requireRole: jest.fn(async () => ({ id: 'model', currentDraftVersionId: 'v-1' })) };
    const trust = {
      mappingHealth: jest.fn(async () => ({ items: [
        { id: 'm-3', state: 'broken', documentName: 'orders.csv', conceptLabel: 'Order', missingFields: ['order_no'] },
        { id: 'm-4', state: 'healthy', documentName: 'ok.csv', conceptLabel: 'Order', missingFields: [] },
        { id: 'm-5', state: 'changed', documentName: 'prices.csv', conceptLabel: 'Price', missingFields: [] },
      ] })),
    };
    const runtime = {
      getBoundRecords: options.runtimeDown ? jest.fn(async () => { throw new Error('no data'); }) : jest.fn(async () => ({
        specification: { concepts: [{ conceptId: 'c-1', label: 'Customer' }], relations: [] },
        gaps: { missingValues: [{ conceptId: 'c-1', attribute: 'city', missing: 3, total: 10 }], unresolvedLinks: [], other: [] },
      })),
    };
    return new SemanticReviewQueueService(database as never, models as never, trust as never, runtime as never);
  };

  it('combines every kind of item, blocking ones first, each with one action', async () => {
    const queue = await setup().reviewQueue('user', 'model');
    expect(queue.count).toBe(7);
    expect(queue.items.map((item) => item.kind)).toEqual([
      'source_broken', 'missing_unique_field', 'source_changed', 'ambiguous_link', 'source_conflict', 'relationship_not_linked', 'missing_values',
    ]);
    expect(queue.items.find((item) => item.kind === 'ambiguous_link')).toMatchObject({
      params: { record: 'Acme', relationship: 'holds', count: 2 },
      action: { kind: 'choose_match', reviewItemId: 'rev-1', select: 'target', options: [{ value: 'e-1', label: 'Contract A' }, { value: 'e-2', label: 'Contract B' }] },
    });
    expect(queue.items.find((item) => item.kind === 'source_conflict')?.action).toMatchObject({
      select: 'source', options: [{ value: 'm-1', label: 'crm.csv' }, { value: 'm-2', label: 'customers.xlsx' }],
    });
    expect(queue.items.find((item) => item.kind === 'missing_values')).toMatchObject({
      params: { concept: 'Customer', field: 'City', missing: 3, total: 10 }, action: { kind: 'fix_values', conceptId: 'c-1' },
    });
    expect(queue.items.find((item) => item.kind === 'missing_unique_field')?.action).toEqual({ kind: 'choose_unique_field', conceptId: 'c-2' });
    expect(queue.items.find((item) => item.kind === 'source_broken')?.action).toEqual({ kind: 'repair_mapping', mappingId: 'm-3' });
  });

  it('still lists the model decisions when no data has been prepared', async () => {
    const queue = await setup({ runtimeDown: true }).reviewQueue('user', 'model');
    expect(queue.items.some((item) => item.kind === 'missing_values')).toBe(false);
    expect(queue.count).toBe(6);
  });
});
