import { SemanticBusinessTrustService } from './semantic-business-trust.service';

describe('SemanticBusinessTrustService', () => {
  const mapping = {
    id: 'mapping', conceptId: 'concept', conceptLabel: 'Contract', workspaceId: 'workspace', documentId: 'document',
    sheetName: 'Contracts', assetKind: 'csv', fieldMappings: [{ sourceField: 'old_id', targetAttribute: 'id', mode: 'direct' }],
    status: 'ready', sourceEnabled: true, validatedSourceVersion: 'old-version', validatedAt: new Date(),
  };

  const buildService = () => {
    const client = { query: jest.fn() };
    const database = {
      query: jest.fn(),
      transaction: jest.fn(async (work: (value: typeof client) => Promise<unknown>) => work(client)),
    };
    const models = {
      requireRole: jest.fn().mockResolvedValue({ id: 'model', currentDraftVersionId: 'version', role: 'editor' }),
      requireActiveRole: jest.fn().mockResolvedValue({ id: 'model', currentDraftVersionId: 'version', role: 'editor' }),
      advanceRevision: jest.fn().mockResolvedValue(8),
      audit: jest.fn(),
    };
    return {
      service: new SemanticBusinessTrustService(database as never, models as never),
      database,
      models,
      client,
    };
  };

  it('returns persisted broken mapping health without reparsing the source', async () => {
    const { service, database } = buildService();
    database.query.mockResolvedValueOnce({ rows: [{ ...mapping, state: 'broken', missingFields: ['old_id'], availableFields: ['contract_id'], totalCount: '1' }] });

    await expect(service.mappingHealth('user', 'model')).resolves.toMatchObject({
      summary: { broken: 1 },
      items: [{ state: 'broken', missingFields: ['old_id'], availableFields: ['contract_id'] }],
    });
    expect(database.query).toHaveBeenCalledTimes(1);
    expect(String(database.query.mock.calls[0][0])).toContain('semantic_datasource.mapping_health');
  });

  it('restores health after a source reconnects without writing for a viewer', async () => {
    const { service, database, models } = buildService();
    models.requireActiveRole.mockResolvedValue({ id: 'model', currentDraftVersionId: 'version', role: 'viewer' });
    database.query.mockResolvedValueOnce({ rows: [{ ...mapping, state: 'healthy', totalCount: '1' }] });

    await expect(service.mappingHealth('viewer', 'model')).resolves.toMatchObject({ summary: { healthy: 1 } });
    expect(database.query).toHaveBeenCalledTimes(1);
  });

  it('explains readiness as five deterministic business areas', async () => {
    const { service, database } = buildService();
    database.query.mockResolvedValue({ rows: [{
      nodeCount: '3', dataConceptCount: '2', sourcedConceptCount: '1', identityCount: '2',
      relationCount: '1', ruleCount: '1', unhealthyMappingCount: '1', openReviewCount: '2',
    }] });

    await expect(service.readiness('user', 'model')).resolves.toMatchObject({
      score: 60,
      areas: [
        { key: 'structure', complete: true },
        { key: 'sources', complete: false, issues: [{ severity: 'blocking' }] },
        { key: 'identity', complete: true },
        { key: 'relationships', complete: true },
        { key: 'quality', complete: false, issues: [{ severity: 'review' }] },
      ],
    });
    const sql = String(database.query.mock.calls[0][0]);
    expect(sql).toContain('n.version_id=$2');
    expect(sql).toContain('relation.version_id=$2');
    expect(database.query.mock.calls[0][1]).toEqual(['model', 'version']);
  });

  it('does not advertise an empty model as ready', async () => {
    const { service, database } = buildService();
    database.query.mockResolvedValue({ rows: [{ nodeCount: '0', dataConceptCount: '0', sourcedConceptCount: '0', identityCount: '0', relationCount: '0', ruleCount: '0', unhealthyMappingCount: '0', openReviewCount: '0' }] });

    await expect(service.readiness('user', 'model')).resolves.toMatchObject({ status: 'not_configured', score: 0 });
  });

  it('resolves a review item with revision concurrency and an audit record', async () => {
    const { service, client, models } = buildService();
    client.query.mockResolvedValueOnce({ rows: [{ kind: 'ambiguous_relation', targetId: 'relation', status: 'open', details: { targetEntityIds: ['organization-1'] } }] }).mockResolvedValue({ rows: [] });

    await expect(service.resolveReviewItem('user', 'model', 'review', {
      expectedRevision: 7, decision: 'accepted', selectedTargetId: 'organization-1',
    })).resolves.toEqual({ revision: 8 });
    expect(models.advanceRevision).toHaveBeenCalledWith(client, 'model', 7);
    expect(models.audit).toHaveBeenCalledWith(client, 'model', 'version', 'user', 'review_item.resolved', expect.objectContaining({ decision: 'accepted' }));
  });

  it('rejects an accepted value outside the review candidates', async () => {
    const { service, client, models } = buildService();
    client.query.mockResolvedValueOnce({ rows: [{ kind: 'ambiguous_relation', targetId: 'relation', status: 'open', details: { targetEntityIds: ['organization-1'] } }] });

    await expect(service.resolveReviewItem('user', 'model', 'review', {
      expectedRevision: 7, decision: 'accepted', selectedTargetId: 'not-a-candidate',
    })).rejects.toThrow('candidate relationship targets');
    expect(models.advanceRevision).not.toHaveBeenCalled();
    });
  });
