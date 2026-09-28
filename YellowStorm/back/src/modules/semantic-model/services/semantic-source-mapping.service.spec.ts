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

  it('saves one mapping for every readable file of a workspace folder, named after the workspace and folder', async () => {
    const database = {
      query: jest.fn(async (sql: string) => sql.includes('FROM semantic_model.node_types')
        ? { rows: [{ label: 'Contract', attributes: [{ key: 'number', label: 'Number', type: 'text' }] }] }
        : { rows: [{ ok: 1 }] }),
      transaction: jest.fn(async (work: (client: unknown) => unknown) => work(client)),
    };
    const client = { query: jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [] })) };
    const models = {
      requireActiveRole: jest.fn().mockResolvedValue({ id: 'model-1', currentDraftVersionId: 'version-1' }),
      advanceRevision: jest.fn().mockResolvedValue(8),
      audit: jest.fn(),
    };
    const documents = {
      findById: jest.fn().mockResolvedValue({ id: 'folder-1', isFolder: true, folderName: 'Contracts', originalName: 'Contracts' }),
      listAllInWorkspace: jest.fn().mockResolvedValue([
        { id: 'folder-1', isFolder: true, mimeType: '', parentId: null, folderName: 'Contracts', originalName: 'Contracts' },
        { id: 'a', isFolder: false, mimeType: 'application/pdf', parentId: 'folder-1', indexingStatus: 'ready' },
        { id: 'b', isFolder: false, mimeType: 'application/pdf', parentId: 'folder-1', indexingStatus: 'pending' },
      ]),
    };
    const workspaces = { findById: jest.fn().mockResolvedValue({ name: 'Legal' }) };
    const service = new SemanticSourceMappingService(database as never, models as never, documents as never,
      {} as never, { preview: jest.fn() } as never, workspaces as never);
    await expect(service.createWorkspace('user-1', 'model-1', {
      expectedRevision: 7, conceptId: 'concept-1', workspaceId: 'ws-1', folderId: 'folder-1',
      fieldMappings: [{ sourceField: 'Contract number', targetAttribute: 'number', mode: 'extract' }],
    } as never)).resolves.toEqual({ revision: 8, fileCount: 1, waitingCount: 1 });
    const insert = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO semantic_model.source_mappings')) as unknown as [string, unknown[]];
    expect(insert[0]).toContain("'workspace'");
    expect(insert[1]).toEqual(expect.arrayContaining(['workspace:ws-1:folder-1', '{"folderIds":["folder-1"],"documentIds":[]}', 'Legal / Contracts']));
  });

  it('covers picked folders and files with one mapping, and changes what an existing one covers', async () => {
    const client = { query: jest.fn(async (_sql: string, _params?: unknown[]) => ({ rows: [], rowCount: 1 })) };
    const database = { transaction: jest.fn(async (work: (client: unknown) => unknown) => work(client)), query: jest.fn(async (sql: string) => sql.includes('FROM semantic_model.node_types')
      ? { rows: [{ label: 'Contract', attributes: [{ key: 'number', label: 'Number', type: 'text' }] }] }
      : { rows: [{ ok: 1 }] }) };
    const models = { requireActiveRole: jest.fn().mockResolvedValue({ id: 'model-1', currentDraftVersionId: 'version-1' }), advanceRevision: jest.fn().mockResolvedValue(8), audit: jest.fn() };
    const documents = {
      listAllInWorkspace: jest.fn().mockResolvedValue([
        { id: 'f1', isFolder: true, mimeType: '', parentId: null, folderName: 'Contracts', originalName: 'Contracts' },
        { id: 'f2', isFolder: true, mimeType: '', parentId: null, folderName: 'NDAs', originalName: 'NDAs' },
        { id: 'a', isFolder: false, mimeType: 'application/pdf', parentId: 'f1', indexingStatus: 'ready', originalName: 'a.pdf' },
        { id: 'b', isFolder: false, mimeType: 'application/pdf', parentId: 'f2', indexingStatus: 'ready', originalName: 'b.pdf' },
        { id: 'loose', isFolder: false, mimeType: 'application/pdf', parentId: null, indexingStatus: 'ready', originalName: 'loose.pdf' },
        { id: 'sheet', isFolder: false, mimeType: 'text/csv', parentId: null, indexingStatus: 'ready', originalName: 'sheet.csv' },
      ]),
    };
    const service = new SemanticSourceMappingService(database as never, models as never, documents as never,
      {} as never, { preview: jest.fn() } as never, { findById: jest.fn().mockResolvedValue({ name: 'Legal' }) } as never);
    const dto = { expectedRevision: 7, conceptId: 'concept-1', workspaceId: 'ws-1', folderIds: ['f1'], documentIds: ['loose'],
      fieldMappings: [{ sourceField: null, targetAttribute: 'number', mode: 'extract' }] };
    await expect(service.createWorkspace('user-1', 'model-1', dto as never)).resolves.toEqual({ revision: 8, fileCount: 2, waitingCount: 0 });
    const insert = client.query.mock.calls.find(([sql]) => String(sql).includes('INSERT INTO semantic_model.source_mappings')) as unknown as [string, unknown[]];
    expect(insert[1]).toEqual(expect.arrayContaining([expect.stringMatching(/^workspace:ws-1:pick-/), '{"folderIds":["f1"],"documentIds":["loose"]}', 'Legal / Contracts, loose.pdf']));

    client.query.mockClear();
    await service.createWorkspace('user-1', 'model-1', { ...dto, mappingId: '00000000-0000-4000-8000-000000000001' } as never);
    const update = client.query.mock.calls.find(([sql]) => String(sql).includes('UPDATE semantic_model.source_mappings')) as unknown as [string, unknown[]];
    expect(update[1][0]).toBe('00000000-0000-4000-8000-000000000001');
    expect(client.query.mock.calls.some(([sql]) => String(sql).includes('INSERT INTO semantic_model.source_mappings'))).toBe(false);

    await expect(service.createWorkspace('user-1', 'model-1', { ...dto, documentIds: ['sheet'] } as never)).rejects.toThrow('sheet.csv cannot be read as a document');
    await expect(service.createWorkspace('user-1', 'model-1', { ...dto, folderIds: ['a'] } as never)).rejects.toThrow('not a folder');
  });

  it('keeps where source boxes sit on the canvas, for editors only, without touching the model revision', async () => {
    const { service, database, models } = buildService();
    database.query.mockResolvedValue({ rows: [] });
    await expect(service.saveCanvasPositions('user-1', 'model-1', [{ id: 'typed:concept-1', x: 10, y: 20 }])).resolves.toEqual({ saved: 1 });
    expect(models.requireActiveRole).toHaveBeenCalledWith('user-1', 'model-1', ['owner', 'editor']);
    const [sql, params] = database.query.mock.calls[0];
    expect(sql).toContain('ON CONFLICT (model_id, element_id)');
    expect(sql).not.toContain('revision');
    expect(JSON.parse(params[1])).toEqual([{ id: 'typed:concept-1', x: 10, y: 20 }]);
    database.query.mockResolvedValueOnce({ rows: [{ id: 'typed:concept-1', x: 10, y: 20 }] });
    await expect(service.listCanvasPositions('user-1', 'model-1')).resolves.toEqual({ positions: [{ id: 'typed:concept-1', x: 10, y: 20 }] });
  });

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
