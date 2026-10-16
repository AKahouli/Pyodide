import { SemanticModelHealthService } from './semantic-model-health.service';

describe('SemanticModelHealthService', () => {
  const records = {
    dataRevisionId: 'dr-1',
    specification: { concepts: [{ conceptId: 'c-1', label: 'Participation', allowedFields: [] }, { conceptId: 'c-2', label: 'Message', allowedFields: [] }], relations: [] },
    conceptCounts: { 'c-1': 3, 'c-2': 10 },
    gaps: { missingValues: [], unresolvedLinks: [], other: [] },
    health: { version: 1, concepts: {
      'c-1': { conceptId: 'c-1', keyFields: ['role'], workspaceIds: ['ws-1'], sources: [{ name: 'mail.zip', sheet: 'participants', rowsAvailable: 400, rowsRead: 400 }],
        rowsAvailable: 400, rowsRead: 400, rowsKeyed: 400, recordsMade: 3, dropped: [{ reason: 'same_key', rows: 397 }],
        findings: [{ kind: 'identity_too_coarse', rows: 400, entities: 3, keyFields: ['role'], discardedValues: 900, keyCardinality: { role: 3 },
          topKeyValues: [{ values: { role: 'to' }, rows: 200 }], suggestedKey: { fields: ['role', 'address'], estimatedRecords: 400, sampleRows: 400 }, examples: [] }] },
    } },
  };
  const setup = (options: { runtimeDown?: boolean; withGraphSearch?: boolean } = {}) => {
    const database = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes('FROM semantic_model.node_types')) return { rows: [{ id: 'c-1', label: 'Participation', attributes: [{ key: 'role', label: 'Role' }, { key: 'address', label: 'Address' }] }, { id: 'c-2', label: 'Message', attributes: [] }] };
        if (sql.includes('FROM semantic_model.relation_types')) return { rows: [] };
        if (sql.includes('FROM semantic_model.derived_sources')) return { rows: [] };
        if (sql.includes('FROM semantic_model.source_mappings sm')) return { rows: [{ conceptId: 'c-2', name: 'messages.csv' }] };
        throw new Error(`unexpected query: ${sql}`);
      }),
    };
    const models = { requireRole: jest.fn(async () => ({ id: 'model', currentDraftVersionId: 'v-1' })) };
    const runtime = { getBoundRecords: options.runtimeDown ? jest.fn(async () => { throw new Error('no data'); }) : jest.fn(async () => records) };
    const queue = { reviewQueue: jest.fn(async () => ({ count: 1, items: [{ key: 'unsourced:c-3', group: 'sources', priority: 1, kind: 'concept_without_source', params: { concept: 'Supplier' }, action: { kind: 'add_source', conceptId: 'c-3' } }] })) };
    const graphSearch = { allowedWorkspaceIds: jest.fn(async () => ['ws-1']) };
    const service = new SemanticModelHealthService(database as never, models as never, runtime as never, queue as never,
      options.withGraphSearch === false ? undefined : graphSearch as never);
    return { service, runtime, queue, graphSearch };
  };

  it('explains the last run through the workspaces the person may read, next to what blocks the next run', async () => {
    const { service, runtime, queue, graphSearch } = setup();
    const health = await service.health('user', 'model');
    expect(graphSearch.allowedWorkspaceIds).toHaveBeenCalledWith('user', 'model');
    expect(runtime.getBoundRecords).toHaveBeenCalledWith('model', 'user', 1, ['ws-1']);
    // The queue's data gaps are replaced by the run's own account.
    expect(queue.reviewQueue).toHaveBeenCalledWith('user', 'model', { dataGaps: false });
    expect(health).toMatchObject({ state: 'ready', dataRevisionId: 'dr-1', verdict: { conceptId: 'c-1', kind: 'identity_too_coarse' } });
    expect(health.setup.map((item) => item.kind)).toEqual(['concept_without_source']);
    expect(health.concepts.map((concept) => [concept.label, concept.status, concept.origin.sources])).toEqual([
      ['Participation', 'blocked', ['mail.zip › participants']], ['Message', 'healthy', ['messages.csv']]]);
    expect(health.concepts[0].issues[0].params).toMatchObject({ suggested: 'Role + Address' });
  });

  it('lists only the setup when no data has been prepared', async () => {
    const health = await setup({ runtimeDown: true }).service.health('user', 'model');
    expect(health).toMatchObject({ state: 'no_data', concepts: [], summary: { setupItems: 1 } });
  });

  it('reads no data without source authorization wired', async () => {
    const { service, runtime } = setup({ withGraphSearch: false });
    expect((await service.health('user', 'model')).state).toBe('no_data');
    expect(runtime.getBoundRecords).not.toHaveBeenCalled();
  });
});
