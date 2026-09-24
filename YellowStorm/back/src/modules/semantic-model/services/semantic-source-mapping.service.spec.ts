import {
  computeFieldProfiles,
  identityKeyOf,
  normalizeIdentityValue,
  resolveSheetEntities,
  suggestFieldMappings,
} from '../domain/semantic-source-mapping.types';
import { SemanticSourceMappingService } from './semantic-source-mapping.service';

describe('semantic source mapping domain', () => {
  describe('normalizeIdentityValue / identityKeyOf', () => {
    it('trims and lowercases identity values', () => {
      expect(normalizeIdentityValue('  C001 ')).toBe('c001');
      expect(normalizeIdentityValue(null)).toBe('');
    });

    it('builds composite keys from several fields', () => {
      const row = { contract: ' SONY-01 ', amendment: 2 };
      expect(identityKeyOf(row, ['contract', 'amendment'])).toBe('sony-01\u00002');
    });
  });

  describe('suggestFieldMappings', () => {
    const attributes = [
      { key: 'id', label: 'Identifier', type: 'text' as const, required: true },
      { key: 'name', label: 'Name', type: 'text' as const, required: true },
    ];

    it('matches source fields to attributes by normalized name', () => {
      const suggestions = suggestFieldMappings(['id', 'name', 'Customer ID', 'unknown_field'], attributes);
      expect(suggestions).toEqual([
        { sourceField: 'id', targetAttribute: 'id', mode: 'direct', suggested: true },
        { sourceField: 'name', targetAttribute: 'name', mode: 'direct', suggested: true },
        { sourceField: 'Customer ID', targetAttribute: '', mode: 'ignore', suggested: false },
        { sourceField: 'unknown_field', targetAttribute: '', mode: 'ignore', suggested: false },
      ]);
    });

    it('keeps confirmed existing mappings', () => {
      const suggestions = suggestFieldMappings(['customer_id'], attributes, [
        { sourceField: 'customer_id', targetAttribute: 'name', mode: 'direct' },
      ]);
      expect(suggestions[0]).toEqual({ sourceField: 'customer_id', targetAttribute: 'name', mode: 'direct', suggested: false });
    });
  });

  describe('resolveSheetEntities', () => {
    const mappings = [
      { sourceField: 'customer_id', targetAttribute: 'id', mode: 'direct' as const },
      { sourceField: 'legal_name', targetAttribute: 'name', mode: 'direct' as const },
      { sourceField: null, targetAttribute: 'segment', mode: 'constant' as const, constantValue: 'Enterprise' },
    ];
    const rows = [
      { customer_id: 'C001', legal_name: 'Sony Europe B.V.' },
      { customer_id: 'C001', legal_name: 'duplicate row' },
      { customer_id: '   ', legal_name: 'no identity' },
      { customer_id: 'C002', legal_name: 'Sony France SAS' },
    ];

    it('resolves entities with provenance, deduping on the identity key', () => {
      const { entities, stats } = resolveSheetEntities(rows, mappings, ['id']);
      expect(entities).toHaveLength(2);
      expect(entities[0]).toMatchObject({
        label: 'C001',
        values: { id: 'C001', name: 'Sony Europe B.V.', segment: 'Enterprise' },
        provenance: { rowNumber: 1 },
      });
      expect(stats).toMatchObject({ scannedRows: 4, resolvedEntities: 2, duplicateKeysSkipped: 1, nullIdentitySkipped: 1 });
    });

    it('stops at the requested limit', () => {
      const { entities } = resolveSheetEntities(rows, mappings, ['id'], 1);
      expect(entities).toHaveLength(1);
    });

    it('uses the first mapped field as label when no identity fields are set', () => {
      const { entities } = resolveSheetEntities(rows, mappings, []);
      expect(entities[0].label).toBe('C001');
    });
  });

  describe('computeFieldProfiles', () => {
    it('computes populated and unique ratios with inferred types', () => {
      const profiles = computeFieldProfiles([
        { id: 'C001', country: 'NL', ok: true },
        { id: 'C001', country: null, ok: false },
        { id: 'C002', country: 'FR', ok: true },
      ]);
      expect(profiles.find((profile) => profile.name === 'id')).toMatchObject({ type: 'text', populatedRatio: 1, uniqueRatio: 2 / 3 });
      expect(profiles.find((profile) => profile.name === 'country')).toMatchObject({ populatedRatio: 2 / 3, uniqueRatio: 1 });
      expect(profiles.find((profile) => profile.name === 'ok')).toMatchObject({ type: 'boolean' });
    });
  });
});

describe('SemanticSourceMappingService boundaries', () => {
  const buildService = (mimeType = 'application/pdf') => {
    const database = { query: jest.fn() };
    const models = {
      requireRole: jest.fn().mockResolvedValue({ id: 'model-1', currentDraftVersionId: 'version-1' }),
      requireActiveRole: jest.fn().mockResolvedValue({ id: 'model-1', currentDraftVersionId: 'version-1' }),
    };
    const documents = { findById: jest.fn().mockResolvedValue({ id: 'document-1', workspaceId: 'workspace-1', mimeType, originalName: 'Source.pdf', size: 10, updatedAt: 'now', indexingStatus: 'ready' }), findByIds: jest.fn() };
    const runtime = { requestDatasourceDiscovery: jest.fn(), getJob: jest.fn() };
    const service = new SemanticSourceMappingService(
      database as never,
      models as never,
      documents as never,
      runtime as never,
      { preview: jest.fn() } as never,
    );
    return { service, database, models, documents, runtime };
  };

  it('reads a persisted profile without admitting a job on GET', async () => {
    const { service, database, runtime } = buildService('text/csv');
    database.query
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ profile: {
        structure: { kind: 'csv', selectedSheet: 'CSV', dataRows: 2 },
        fieldProfiles: [{ name: 'id', type: 'text', sample: 'C1', populatedRatio: 1, uniqueRatio: 1 }],
        samples: [{ id: 'C1' }], scannedRows: 2, coverage: { completeProfileDone: true },
      } }] });

    await expect(service.profileAsset('user-1', 'model-1', 'workspace-1', 'document-1', {
      workspaceId: 'workspace-1', sheetName: 'CSV',
    })).resolves.toMatchObject({ fields: [{ name: 'id' }], totalRows: 2, complete: true });
    expect(database.query).toHaveBeenLastCalledWith(expect.stringContaining('source_version=$3'), [
      'workspace-1', 'document-1', 'now:10', 'CSV',
    ]);
    expect(runtime.requestDatasourceDiscovery).not.toHaveBeenCalled();
  });

  it('rejects a client asset kind that conflicts with the stored MIME type', async () => {
    const { service, database } = buildService();
    database.query.mockResolvedValue({ rows: [{}] });

    await expect(service.preview('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1', assetKind: 'csv',
      fieldMappings: [], identityFields: [],
    })).rejects.toThrow('asset kind');
  });

  it('requires identities to reference mapped concept attributes', async () => {
    const { service, database } = buildService('text/csv');
    database.query
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ label: 'Customer', attributes: [{ key: 'id', label: 'ID', type: 'text', required: true }] }] });

    await expect(service.preview('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1', assetKind: 'csv', sheetName: 'CSV',
      fieldMappings: [{ sourceField: 'customer_id', targetAttribute: 'id', mode: 'direct' }], identityFields: ['customer_id'],
    })).rejects.toThrow('mapped concept attributes');
  });

  it('rejects an extraction strategy outside an extracted document field', async () => {
    const { service, database } = buildService('text/csv');
    database.query
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ label: 'Customer', attributes: [{ key: 'id', label: 'ID', type: 'text', required: true }] }] });

    await expect(service.preview('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1', assetKind: 'csv', sheetName: 'CSV',
      fieldMappings: [{ sourceField: 'customer_id', targetAttribute: 'id', mode: 'direct', extractionStrategy: 'ai' }],
      identityFields: ['customer_id'],
    })).rejects.toThrow('extraction strategy');
  });

  it('lists mappings only through enabled workspace links', async () => {
    const { service, database, documents } = buildService();
    database.query.mockResolvedValue({ rows: [] });
    documents.findByIds.mockResolvedValue([]);

    await service.list('user-1', 'model-1');

    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('w.enabled'), ['model-1']);
  });

  it('allows active viewers to resolve the bounded model data preview', async () => {
    const { service, database, models } = buildService();
    database.query.mockResolvedValue({ rows: [] });

    await expect(service.resolveConfigured('viewer', 'model-1')).resolves.toEqual({ entities: [], issues: [], incompleteConceptIds: [] });
    expect(models.requireActiveRole).toHaveBeenCalledWith('viewer', 'model-1', ['owner', 'editor', 'viewer']);
  });

  it('marks a concept incomplete when one of its configured sources is unavailable', async () => {
    const { service, database, documents } = buildService();
    database.query.mockResolvedValue({ rows: [{
      id: 'mapping-1', conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1',
      sheetName: '', assetKind: 'document', fieldMappings: [], identityFields: [], status: 'ready', sourceEnabled: true,
    }] });
    documents.findById.mockRejectedValue(new Error('unavailable'));
    documents.findByIds.mockResolvedValue([{ id: 'document-1', originalName: 'Source.pdf' }]);

    await expect(service.resolveConfigured('viewer', 'model-1')).resolves.toMatchObject({
      incompleteConceptIds: ['concept-1'],
      issues: [{
        mappingId: 'mapping-1', conceptId: 'concept-1', documentName: 'Source.pdf', code: 'source_failed',
        message: 'Source.pdf could not be read: unavailable',
        detail: 'Error: unavailable',
      }],
    });
  });

  it('marks a disconnected mapping incomplete without accessing its document', async () => {
    const { service, database, documents } = buildService();
    database.query.mockResolvedValue({ rows: [{
      id: 'mapping-1', conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1',
      sheetName: '', assetKind: 'document', fieldMappings: [], identityFields: [], status: 'ready', sourceEnabled: false,
    }] });
    documents.findByIds.mockResolvedValue([{ id: 'document-1', originalName: 'Source.pdf' }]);

    await expect(service.resolveConfigured('viewer', 'model-1')).resolves.toMatchObject({
      entities: [],
      incompleteConceptIds: ['concept-1'],
      issues: [{ mappingId: 'mapping-1', code: 'source_disabled', documentName: 'Source.pdf' }],
    });
    expect(documents.findById).not.toHaveBeenCalled();
  });
});
