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
        if (sql.includes('FROM semantic_model.derived_sources d')) {
          const row = { conceptId: 'c-5', concept: 'Organization', source: 'Contract', targetFields: ['id', 'name'], identity: ['id'],
            fieldMappings: [{ sourceAttribute: 'customer_id', targetAttribute: 'id' }], conflictRule: 'latest' };
          return { rows: [
            { ...row, id: 'dv-1', orderBy: 'effective_date', sourceFields: ['customer_id', 'date'] },
            { ...row, id: 'dv-2', orderBy: 'date', sourceFields: ['customer_id', 'date'] },
          ] };
        }
        if (sql.includes('identity_rules')) return { rows: [{ id: 'c-2', label: 'Invoice' }] };
        if (sql.includes('relation_resolution_rules')) return { rows: [{ id: 'rel-2', label: 'bills', source: 'Invoice', target: 'Customer' }] };
        if (sql.includes('jsonb_array_elements(sm.field_mappings)')) {
          return { rows: [
            { mappingId: 'd-1', conceptId: 'c-4', concept: 'Contract', scope: 'document', fields: ['Customer name'], keys: ['customer_name'] },
            { mappingId: 'd-2', conceptId: 'c-4', concept: 'Contract', scope: 'document', fields: ['Customer name'], keys: ['customer_name'] },
          ] };
        }
        if (sql.includes('FROM semantic_model.relation_types r')) return { rows: [{ id: 'rel-1', label: 'holds a contract' }] };
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
        specification: { concepts: [{ conceptId: 'c-1', label: 'Customer' }], relations: [{ relationId: 'rel-1', label: 'holds_contract' }] },
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
    expect(queue.count).toBe(14);
    expect(queue.items.map((item) => item.kind)).toEqual([
      'fields_not_read', 'derived_source_broken', 'source_broken', 'source_workspace_off', 'concept_without_source', 'rows_not_read', 'missing_unique_field',
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
      params: { relationship: 'holds a contract', count: 4 }, action: { kind: 'check_links', relationId: 'rel-1' },
    });
    expect(queue.items.find((item) => item.kind === 'rows_not_read')?.action).toEqual({ kind: 'review_rows', conceptId: 'c-1' });
    expect(queue.items.some((item) => item.kind === 'field_not_found')).toBe(false);
    expect(queue.items.find((item) => item.kind === 'concept_without_source')?.action).toEqual({ kind: 'add_source', conceptId: 'c-3' });
    // A source already reported by its health check is not listed twice.
    expect(queue.items.filter((item) => item.key === 'mapping:m-3')).toHaveLength(1);
    expect(queue.items.find((item) => item.kind === 'missing_unique_field')?.action).toEqual({ kind: 'choose_unique_field', conceptId: 'c-2' });
    expect(queue.items.find((item) => item.kind === 'source_broken')?.action).toEqual({ kind: 'repair_mapping', mappingId: 'm-3' });
    // A field added after two documents were mapped one by one: both are updated together.
    expect(queue.items.find((item) => item.kind === 'fields_not_read')).toMatchObject({
      params: { concept: 'Contract', fields: 'Customer name', count: 2 },
      action: { kind: 'repair_mapping', mappingId: 'd-1', bulkEdit: true },
    });
    // The date the most recent rule orders by was removed; the other derived source still works.
    expect(queue.items.filter((item) => item.kind === 'derived_source_broken')).toEqual([expect.objectContaining({
      params: { concept: 'Organization', source: 'Contract', fields: 'effective date' },
      action: { kind: 'repair_derived', derivedSourceId: 'dv-1', conceptId: 'c-5' },
    })]);
  });

  it('lists what stops the next run, each opening where it is fixed, and a failed last run', async () => {
    const database = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('SELECT id::text AS id, label, attributes FROM semantic_model.node_types')) {
          return { rows: [
            { id: 'pj', label: 'Pièce jointe', attributes: [{ key: 'cle_piece_jointe', label: 'Clé', type: 'text' }] },
            { id: 'fait', label: 'Fait', attributes: [{ key: 'cle_piece_jointe', label: 'Clé de la pièce jointe', type: 'text' }, { key: 'cle_message', type: 'text' }] },
            { id: 'msg', label: 'Message', attributes: [{ key: 'cle', label: 'Clé', type: 'text' }] },
          ] };
        }
        if (sql.includes('AS "sourceAttribute"')) {
          return { rows: [
            { relationId: 'documente', label: 'documente', sourceId: 'pj', targetId: 'fait', sourceAttribute: 'cle_piece_jointe', targetAttribute: 'cle_piece_jointe' },
            { relationId: 'concerne', label: 'concerne', sourceId: 'fait', targetId: 'msg', sourceAttribute: 'cle_message', targetAttribute: 'cle_renamed' },
          ] };
        }
        if (sql.includes('UNION SELECT d.concept_id')) {
          return { rows: [
            { conceptId: 'pj', field: 'cle_piece_jointe' }, { conceptId: 'fait', field: 'cle_message' }, { conceptId: 'msg', field: 'cle' },
          ] };
        }
        if (sql.includes('SELECT concept_id::text AS "conceptId", fields FROM semantic_model.identity_rules')) {
          return { rows: [{ conceptId: 'msg', fields: ['cle_old', 'cle'] }] };
        }
        if (sql.includes('FROM semantic_model.label_fields')) return { rows: [{ conceptId: 'pj', field: 'cle_piece_jointe' }, { conceptId: 'msg', field: 'sujet' }] };
        return { rows: [] };
      }),
    };
    const models = { requireRole: jest.fn(async () => ({ id: 'model', currentDraftVersionId: 'v-1' })) };
    const runtime = {
      getBoundRecords: jest.fn(async () => { throw new Error('no data'); }),
      listJobs: jest.fn(async () => [{ jobId: 'job-1', state: 'failed', errorCode: 'worker_lost', completedAt: '2026-10-04T10:00:00Z' }]),
    };
    const refresh = { freshness: jest.fn(async () => ({ state: 'not_runnable', reason: 'Link "documente" …' })) };
    const queue = await new SemanticReviewQueueService(database as never, models as never, { mappingHealth: jest.fn(async () => null) } as never,
      runtime as never, refresh as never).reviewQueue('user', 'model');

    expect(queue.items.find((item) => item.key === 'run:link:documente')).toMatchObject({
      kind: 'link_field_not_filled', priority: 1,
      params: { relationship: 'documente', concept: 'Fait', field: 'Clé de la pièce jointe' },
      action: { kind: 'set_up_link', relationId: 'documente' },
    });
    expect(queue.items.find((item) => item.key === 'run:link:concerne')).toMatchObject({
      kind: 'link_field_gone', params: { concept: 'Message', field: 'cle renamed' } });
    expect(queue.items.find((item) => item.kind === 'unique_field_gone')).toMatchObject({
      params: { concept: 'Message', fields: 'cle old' }, action: { kind: 'choose_unique_field', conceptId: 'msg' } });
    expect(queue.items.find((item) => item.kind === 'last_run_failed')).toMatchObject({
      params: { error: 'worker_lost' }, action: { kind: 'open_run_history' } });
    // Each concept with a source names its records with a field a person chose.
    expect(queue.items.find((item) => item.key === 'run:label:fait')).toMatchObject({ kind: 'missing_label_field',
      params: { concept: 'Fait' }, action: { kind: 'choose_label_field', conceptId: 'fait' } });
    expect(queue.items.find((item) => item.key === 'run:label:msg')).toMatchObject({ kind: 'label_field_gone', params: { field: 'sujet' } });
    expect(queue.items.some((item) => item.key === 'run:label:pj')).toBe(false);
    // The reason the run gives is already explained by the items above: not listed again.
    expect(queue.items.some((item) => item.kind === 'run_blocked')).toBe(false);
  });

  it('lists the reason a run cannot start when nothing else explains it', async () => {
    const database = { query: jest.fn(async () => ({ rows: [] })) };
    const queue = await new SemanticReviewQueueService(database as never,
      { requireRole: jest.fn(async () => ({ id: 'model', currentDraftVersionId: 'v-1' })) } as never,
      { mappingHealth: jest.fn(async () => null) } as never,
      { getBoundRecords: jest.fn(async () => { throw new Error('no data'); }), listJobs: jest.fn(async () => []) } as never,
      { freshness: jest.fn(async () => ({ state: 'not_runnable', reason: 'The workspace has no readable file yet' })) } as never,
    ).reviewQueue('user', 'model');
    expect(queue.items).toEqual([expect.objectContaining({ kind: 'run_blocked', params: { reason: 'The workspace has no readable file yet' },
      action: { kind: 'open_run_history' } })]);
  });

  it('still lists the model decisions when no data has been prepared', async () => {
    const queue = await setup({ runtimeDown: true }).reviewQueue('user', 'model');
    expect(queue.items.some((item) => item.kind === 'missing_values')).toBe(false);
    expect(queue.count).toBe(10);
  });
});
