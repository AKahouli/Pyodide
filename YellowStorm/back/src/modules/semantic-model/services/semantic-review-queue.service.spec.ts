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
        if (sql.includes("sm.status<>'ready'")) return { rows: [{ id: 'm-6', concept: 'Order', document: 'old.csv', ready: true }, { id: 'm-3', concept: 'Order', document: 'orders.csv', ready: false }] };
        if (sql.includes('NOT EXISTS (SELECT 1 FROM semantic_model.source_mappings sm')) return { rows: [{ id: 'c-3', label: 'Supplier' }] };
        if (sql.includes('FROM semantic_model.source_mappings m')) return { rows: [{ id: 'm-1', name: 'crm.csv' }, { id: 'm-2', name: 'customers.xlsx' }] };
        if (sql.includes('identity_rules')) return { rows: [{ id: 'c-2', label: 'Invoice' }] };
        if (sql.includes('relation_resolution_rules')) return { rows: [{ id: 'rel-2', label: 'bills', source: 'Invoice', target: 'Customer' }] };
        if (sql.includes('n.attributes')) return { rows: [{ id: 'c-1', attributes: [{ key: 'city', label: 'City' }, { key: 'name', label: 'Name', required: true }] }] };
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
        specification: { concepts: [{ conceptId: 'c-1', label: 'Customer' }], relations: [{ relationId: 'rel-1', label: 'holds' }] },
        gaps: {
          missingValues: [{ conceptId: 'c-1', attribute: 'city', missing: 3, total: 10 }, { conceptId: 'c-1', attribute: 'name', missing: 1, total: 10 }],
          unresolvedLinks: [{ relationId: 'rel-1', kind: 'unmatched', count: 4 }],
          other: [
            { conceptId: 'c-1', kind: 'missing_identity', count: 2 },
            // The same fact as the empty city below, so it is not listed twice.
            { conceptId: 'c-1', kind: 'unresolved_document_field', count: 3, fields: ['city'] },
          ],
        },
      })),
    };
    return new SemanticReviewQueueService(database as never, models as never, trust as never, runtime as never);
  };

  it('combines every kind of item, blocking ones first, each with one action', async () => {
    const queue = await setup().reviewQueue('user', 'model');
    expect(queue.count).toBe(12);
    expect(queue.items.map((item) => item.kind)).toEqual([
      'source_broken', 'source_workspace_off', 'concept_without_source', 'rows_not_read', 'missing_unique_field',
      'source_changed', 'ambiguous_link', 'source_conflict', 'relationship_not_linked', 'unmatched_links', 'missing_values',
      'missing_values',
    ]);
    expect(queue.items.find((item) => item.kind === 'ambiguous_link')).toMatchObject({
      params: { record: 'Acme', relationship: 'holds', count: 2 },
      action: { kind: 'choose_match', reviewItemId: 'rev-1', select: 'target', options: [{ value: 'e-1', label: 'Contract A' }, { value: 'e-2', label: 'Contract B' }] },
    });
    expect(queue.items.find((item) => item.kind === 'source_conflict')?.action).toMatchObject({
      select: 'source', options: [{ value: 'm-1', label: 'crm.csv' }, { value: 'm-2', label: 'customers.xlsx' }],
    });
    expect(queue.items.find((item) => item.key === 'gap:c-1:city')).toMatchObject({
      params: { concept: 'Customer', field: 'City', missing: 3, total: 10 }, priority: 3, action: { kind: 'fix_values', conceptId: 'c-1', attribute: 'city' },
    });
    // An empty required field matters more than an empty optional one.
    expect(queue.items.find((item) => item.key === 'gap:c-1:name')).toMatchObject({ priority: 2 });
    expect(queue.items.find((item) => item.kind === 'unmatched_links')).toMatchObject({
      params: { relationship: 'holds', count: 4 }, action: { kind: 'check_links', relationId: 'rel-1' },
    });
    expect(queue.items.find((item) => item.kind === 'rows_not_read')?.action).toEqual({ kind: 'review_rows', conceptId: 'c-1' });
    expect(queue.items.some((item) => item.kind === 'field_not_found')).toBe(false);
    expect(queue.items.find((item) => item.kind === 'concept_without_source')?.action).toEqual({ kind: 'add_source', conceptId: 'c-3' });
    // A source already reported by its health check is not listed twice.
    expect(queue.items.filter((item) => item.key === 'mapping:m-3')).toHaveLength(1);
    expect(queue.items.find((item) => item.kind === 'missing_unique_field')?.action).toEqual({ kind: 'choose_unique_field', conceptId: 'c-2' });
    expect(queue.items.find((item) => item.kind === 'source_broken')?.action).toEqual({ kind: 'repair_mapping', mappingId: 'm-3' });
  });

  it('still lists the model decisions when no data has been prepared', async () => {
    const queue = await setup({ runtimeDown: true }).reviewQueue('user', 'model');
    expect(queue.items.some((item) => item.kind === 'missing_values')).toBe(false);
    expect(queue.count).toBe(8);
  });
});
