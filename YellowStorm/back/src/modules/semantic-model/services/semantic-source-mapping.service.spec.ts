import {
  computeFieldProfiles,
  identityKeyOf,
  normalizeIdentityValue,
  resolveSheetEntities,
  suggestFieldMappings,
  type SourceFieldMapping,
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

  it('previews a document as a run reads it, with the mapping limits over the admin defaults', async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ label: 'Amendment', attributes: [
        { key: 'number', label: 'Contract number', type: 'text' }, { key: 'title', label: 'Title', type: 'text' }] }] }) };
    const models = { requireActiveRole: jest.fn().mockResolvedValue({ id: 'model-1', currentDraftVersionId: 'version-1' }) };
    const documents = { findById: jest.fn().mockResolvedValue({ id: 'document-1', mimeType: 'application/pdf', originalName: 'amendment.pdf',
      size: 10, createdBy: 'u-2', indexingStatus: 'ready', contentHash: 'sha256:1' }) };
    const runtime = { previewDocumentFields: jest.fn().mockResolvedValue({ status: 'read', aiSent: null, fields: {
      number: { method: 'rules', reason: 'found', value: 'CNT-1', page: 1, quote: 'Contract number CNT-1' },
      title: { method: 'ai', reason: 'ai_not_found', rules: { method: 'rules', reason: 'label_not_found' } } } }) };
    const agent = { resolveAgent: jest.fn().mockResolvedValue({ slug: 'semantic-field-extraction', llmModel: 'gpt' }) };
    const settings = { getDefaults: jest.fn().mockResolvedValue({ configured: { maxCharacters: 9000 } }) };
    const service = new SemanticSourceMappingService(database as never, models as never, documents as never,
      runtime as never, {} as never, undefined, agent as never, settings as never);

    const result = await service.preview('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1',
      fieldMappings: [
        { sourceField: null, targetAttribute: 'number', mode: 'extract', rules: { location: 'anywhere', pattern: 'CNT-\d+' } },
        { sourceField: null, targetAttribute: 'title', mode: 'extract', extractionStrategy: 'rules_then_ai' }],
      identityFields: ['number'], aiSettings: { blocksPerField: 3 },
    }) as any;

    const request = runtime.previewDocumentFields.mock.calls[0][0];
    expect(request.entry.fieldMappings[1].sourceField).toBe('Title');
    expect(request.entry.options.aiSettings).toEqual({ maxBlocks: 400, maxCharacters: 9000, longDocumentCharacters: 30000, blocksPerField: 3 });
    expect(request.aiExtraction).toMatchObject({ agentSlug: 'semantic-field-extraction', contractVersion: 'ai-attribute-v1' });
    expect(result.entities[0]).toMatchObject({ entityKey: 'cnt-1', values: { number: 'CNT-1' },
      provenance: { fields: { number: { page: '1', quote: 'Contract number CNT-1' } } } });
    expect(result.fields.title.rules.reason).toBe('label_not_found');
  });

  it('tells the preview AI the field definition, or the attribute description when the field has none', async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ label: 'Amendment', attributes: [
        { key: 'number', label: 'Contract number', type: 'text', description: 'The reference of the contract' },
        { key: 'title', label: 'Title', type: 'text', description: 'Attribute description' }] }] }) };
    const models = { requireActiveRole: jest.fn().mockResolvedValue({ id: 'model-1', currentDraftVersionId: 'version-1' }) };
    const documents = { findById: jest.fn().mockResolvedValue({ id: 'document-1', mimeType: 'application/pdf', originalName: 'a.pdf', size: 10, indexingStatus: 'ready' }) };
    const runtime = { previewDocumentFields: jest.fn().mockResolvedValue({ status: 'read', aiSent: null, fields: {} }) };
    const agent = { resolveAgent: jest.fn().mockResolvedValue({ slug: 'semantic-field-extraction', llmModel: 'gpt' }) };
    const service = new SemanticSourceMappingService(database as never, models as never, documents as never,
      runtime as never, {} as never, undefined, agent as never, undefined);

    await service.preview('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1',
      fieldMappings: [
        { sourceField: null, targetAttribute: 'number', mode: 'extract', extractionStrategy: 'ai' },
        { sourceField: null, targetAttribute: 'title', mode: 'extract', extractionStrategy: 'ai',
          semanticDefinition: '  The amendment heading, not the contract name  ', agentId: 'agent-7' }],
      identityFields: ['number'],
    });

    const [number, title] = runtime.previewDocumentFields.mock.calls[0][0].entry.fieldMappings;
    expect(number.description).toBe('The reference of the contract');
    expect(title).toMatchObject({ description: 'The amendment heading, not the contract name', agentId: 'agent-7', valueType: 'text' });
  });

  it('rejects a semantic definition or an agent outside an extracted document field', async () => {
    const { service, database } = buildService('text/csv');
    database.query
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ label: 'Customer', attributes: [{ key: 'id', label: 'ID', type: 'text', required: true }] }] });

    await expect(service.preview('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1', assetKind: 'csv', sheetName: 'CSV',
      fieldMappings: [{ sourceField: 'customer_id', targetAttribute: 'id', mode: 'direct', agentId: 'agent-7' }],
      identityFields: ['customer_id'],
    })).rejects.toThrow('semantic definition or an extraction agent');
  });

  it('passes computed fields to the document preview and maps the found ones', async () => {
    const database = { query: jest.fn()
      .mockResolvedValueOnce({ rows: [{}] })
      .mockResolvedValueOnce({ rows: [{ label: 'Amendment', attributes: [
        { key: 'number', label: 'Number', type: 'text' }, { key: 'year', label: 'Year', type: 'text' }, { key: 'code', label: 'Code', type: 'text' }] }] }) };
    const models = { requireActiveRole: jest.fn().mockResolvedValue({ id: 'model-1', currentDraftVersionId: 'version-1' }) };
    const documents = { findById: jest.fn().mockResolvedValue({ id: 'document-1', mimeType: 'application/pdf', originalName: 'ACME_2024.pdf',
      size: 10, createdBy: 'u-2', indexingStatus: 'ready', contentHash: 'sha256:1' }) };
    const runtime = { previewDocumentFields: jest.fn().mockResolvedValue({ status: 'read', aiSent: null, fields: {
      number: { method: 'rules', reason: 'found', value: 'CNT-1' },
      year: { method: 'computed', reason: 'found', input: 'ACME_2024', value: '2024' },
      code: { method: 'computed', reason: 'no_match', input: 'CNT-1' } } }) };
    const service = new SemanticSourceMappingService(database as never, models as never, documents as never, runtime as never, {} as never);
    const year = { sourceField: null, targetAttribute: 'year', mode: 'computed' as const,
      computed: { input: { kind: 'file' as const, name: 'document_name' as const }, method: 'split' as const, delimiter: '_', part: -1 } };
    const code = { sourceField: null, targetAttribute: 'code', mode: 'computed' as const,
      computed: { input: { kind: 'field' as const, name: 'number' }, method: 'regex' as const, pattern: '-(\\d+)' } };

    const result = await service.preview('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1',
      fieldMappings: [{ sourceField: null, targetAttribute: 'number', mode: 'extract' }, year, code], identityFields: ['number'],
    }) as any;

    expect(runtime.previewDocumentFields.mock.calls[0][0].entry.fieldMappings.slice(1)).toEqual([year, code]);
    expect(result.entities[0].values).toEqual({ number: 'CNT-1', year: '2024' });
    expect(result.entities[0].provenance.fields.year).toEqual({ method: 'computed_field' });
  });

  it('rejects a computed field reading a missing or computed field, and computed fields outside documents', async () => {
    const computedFrom = (name: string) => ({ sourceField: null, targetAttribute: 'code', mode: 'computed' as const,
      computed: { input: { kind: 'field' as const, name }, method: 'split' as const, delimiter: '_', part: 1 } });
    const pdf = buildService();
    pdf.database.query.mockResolvedValue({ rows: [{}] });
    await expect(pdf.service.preview('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1',
      fieldMappings: [computedFrom('missing')], identityFields: [],
    })).rejects.toThrow('non-computed field');
    await expect(pdf.service.preview('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1',
      fieldMappings: [computedFrom('code')], identityFields: [],
    })).rejects.toThrow('non-computed field');
    const csv = buildService('text/csv');
    csv.database.query.mockResolvedValue({ rows: [{}] });
    await expect(csv.service.preview('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1', assetKind: 'csv', sheetName: 'CSV',
      fieldMappings: [computedFrom('id')], identityFields: [],
    })).rejects.toThrow('transformed field reads a column');
  });

  it('accepts a transformed spreadsheet field and rejects one misplaced or chained', async () => {
    const csv = buildService('text/csv');
    csv.database.query.mockResolvedValue({ rows: [{ label: 'Customer', attributes: [{ key: 'id' }, { key: 'name' }] }] });
    const preview = (fieldMappings: SourceFieldMapping[]) => csv.service.preview('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1', assetKind: 'csv', sheetName: 'CSV',
      fieldMappings, identityFields: [],
    });
    const fromColumn = { input: { kind: 'column' as const, name: 'ref' }, method: 'split' as const, delimiter: '-', part: 2 };
    const fromField = (name: string) => ({ input: { kind: 'field' as const, name }, method: 'whole' as const, transform: 'upper' as const });
    const id = { sourceField: 'id', targetAttribute: 'id', mode: 'direct' as const, computed: fromColumn };
    // Past the checks: a recipe on a column, and one on a field read from a column, reach the runtime preview.
    await preview([id, { sourceField: 'name', targetAttribute: 'name', mode: 'direct', computed: fromField('id') }]);
    expect(csv.runtime.requestDatasourceDiscovery).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(csv.runtime.requestDatasourceDiscovery.mock.calls[0][0])).toContain('"kind":"column"');
    await expect(preview([{ sourceField: null, targetAttribute: 'id', mode: 'constant', constantValue: 'x', computed: fromColumn }]))
      .rejects.toThrow('only supported for fields read from a column');
    await expect(preview([id, { sourceField: 'name', targetAttribute: 'name', mode: 'direct', computed: fromField('name') }]))
      .rejects.toThrow('transformed field reads a column');
    await expect(preview([{ ...id, computed: fromField('name') }, { sourceField: 'name', targetAttribute: 'name', mode: 'direct', computed: fromField('id') }]))
      .rejects.toThrow('transformed field reads a column');
    await expect(preview([id, { sourceField: 'name', targetAttribute: 'name', mode: 'direct', computed: fromField('gone') }]))
      .rejects.toThrow('transformed field reads a column');
    const pdf = buildService();
    pdf.database.query.mockResolvedValue({ rows: [{}] });
    await expect(pdf.service.preview('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1',
      fieldMappings: [{ sourceField: null, targetAttribute: 'code', mode: 'computed', computed: fromColumn }], identityFields: [],
    })).rejects.toThrow('non-computed field');
  });

  it('lets a sheet field be read out of its cell like a document field, and keeps old sheet mappings valid', async () => {
    const csv = buildService('text/csv');
    csv.database.query.mockResolvedValue({ rows: [{ label: 'Message', attributes: [{ key: 'id' }, { key: 'reference', label: 'Référence' }, { key: 'code' }] }] });
    const preview = (fieldMappings: SourceFieldMapping[]) => csv.service.preview('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1', assetKind: 'csv', sheetName: 'CSV',
      fieldMappings, identityFields: ['id'],
    });
    const id = { sourceField: 'id', targetAttribute: 'id', mode: 'direct' as const };
    // An old mapping (columns read as they are) passes and reaches the runtime unchanged.
    await preview([id]);
    expect(csv.runtime.requestDatasourceDiscovery.mock.calls[0][0].payload.mappingPreview.fieldMappings).toEqual([id]);
    const reference = { sourceField: 'corps', targetAttribute: 'reference', mode: 'extract' as const, extractionStrategy: 'rules_then_ai' as const,
      rules: { labels: ['Réf'], location: 'same_line' as const }, semanticDefinition: 'The order reference' };
    const code = { sourceField: null, targetAttribute: 'code', mode: 'computed' as const,
      computed: { input: { kind: 'field' as const, name: 'reference' }, method: 'whole' as const, transform: 'upper' as const } };
    await preview([id, reference, code]);
    const sent = csv.runtime.requestDatasourceDiscovery.mock.calls[1][0].payload.mappingPreview.fieldMappings;
    // The field's label is what its rules look for by default, as for a document.
    expect(sent[1]).toEqual({ ...reference, label: 'Référence' });
    expect(sent[2]).toEqual(code);
    await expect(preview([id, { ...reference, sourceField: null }])).rejects.toThrow('choose the column');
    await expect(preview([id, { ...reference, rules: { location: 'pages', pages: { from: 1 } } }])).rejects.toThrow('no pages, headings or tables');
    await expect(preview([id, { ...reference, rules: { firstPageOnly: true } }])).rejects.toThrow('no pages, headings or tables');
    await expect(preview([id, { ...code, computed: undefined }])).rejects.toThrow('needs a recipe');
    await expect(preview([id, { ...id, targetAttribute: 'code', extractionStrategy: 'ai' }])).rejects.toThrow('only supported for extracted fields');
    await expect(preview([id, { sourceField: null, targetAttribute: 'code', mode: 'metadata' }])).rejects.toThrow('metadata mappings are not supported');
  });

  it('reads picked sheet rows through the runtime with what the AI is told', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [{ label: 'Message', attributes: [
      { key: 'id', label: 'Id' }, { key: 'reference', label: 'Référence', type: 'text', description: 'Order reference' }] }] }) };
    const models = { requireActiveRole: jest.fn().mockResolvedValue({ id: 'model-1', currentDraftVersionId: 'version-1' }) };
    const documents = { findById: jest.fn().mockResolvedValue({ id: 'document-1', mimeType: 'application/zip', originalName: 'mails.zip' }) };
    const runtime = { previewSheetFields: jest.fn().mockResolvedValue({ rows: [], ai: { aiRows: 1, aiCalls: 1, aiSkippedRows: 0, aiFailedRows: 0 } }) };
    const agent = { resolveAgent: jest.fn().mockResolvedValue({ slug: 'extractor', llmModel: 'm' }) };
    const settings = { getDefaults: jest.fn().mockResolvedValue({ configured: { maxCharacters: 9000 } }) };
    const service = new SemanticSourceMappingService(database as never, models as never, documents as never, runtime as never, {} as never,
      undefined, agent as never, settings as never);
    const reference = { sourceField: 'corps', targetAttribute: 'reference', mode: 'extract' as const, extractionStrategy: 'ai' as const };
    await service.previewSheetFields('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1',
      fieldMappings: [{ sourceField: 'id', targetAttribute: 'id', mode: 'direct' }, reference, { sourceField: 'x', targetAttribute: '', mode: 'ignore' }],
      rows: [{ rowNumber: 2, values: { id: 'M1', corps: 'Réf: A-1' } }],
    });
    const request = runtime.previewSheetFields.mock.calls[0][0];
    expect(request.entry.fieldMappings).toEqual([{ sourceField: 'id', targetAttribute: 'id', mode: 'direct' },
      { ...reference, label: 'Référence', description: 'Order reference', valueType: 'text' }]);
    expect(request.entry.options.aiSettings.maxCharacters).toBe(9000);
    expect(request.rows).toEqual([{ rowNumber: 2, values: { id: 'M1', corps: 'Réf: A-1' } }]);
    expect(request.aiExtraction).toMatchObject({ agentSlug: 'extractor', model: 'm' });
    const pdf = buildService();
    pdf.database.query.mockResolvedValue({ rows: [{}] });
    await expect(pdf.service.previewSheetFields('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1', fieldMappings: [], rows: [{ rowNumber: 1, values: {} }],
    })).rejects.toThrow('Only spreadsheet');
  });

  it('forwards the input field recipe to the computed preview', async () => {
    const models = { requireActiveRole: jest.fn().mockResolvedValue({ id: 'model-1' }) };
    const runtime = { previewComputedField: jest.fn().mockResolvedValue({ results: [] }) };
    const service = new SemanticSourceMappingService({} as never, models as never, {} as never, runtime as never, {} as never);
    const inputRecipe = { input: { kind: 'column' as const, name: 'ref' }, method: 'whole' as const, transform: 'trim' as const };
    const dto = { computed: { input: { kind: 'field' as const, name: 'id' }, method: 'whole' as const }, samples: [' a '], inputRecipe };
    await service.previewComputed('user-1', 'model-1', dto);
    expect(runtime.previewComputedField).toHaveBeenCalledWith(dto);
  });

  it('reads document labels from the linked workspace documents, reauthorized by the runtime', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [{}] }) };
    const models = { requireActiveRole: jest.fn().mockResolvedValue({ id: 'model-1' }) };
    const documents = { findById: jest.fn().mockImplementation(async (_workspace: string, id: string) => ({
      id, originalName: `${id}.pdf`, createdBy: 'u-2', mimeType: 'application/pdf', size: 10, indexingStatus: 'ready', contentHash: 'h' })) };
    const labels = { documentsRead: 2, unread: [], labels: [{ label: 'DEFINITION', kind: 'heading', documents: 2, page: 3, example: 'Un prêt' }] };
    const runtime = { suggestDocumentLabels: jest.fn().mockResolvedValue(labels) };
    const service = new SemanticSourceMappingService(database as never, models as never, documents as never, runtime as never, {} as never);

    await expect(service.documentLabels('user-1', 'model-1', { workspaceId: 'workspace-1', documentIds: ['a', 'b', 'a'] })).resolves.toEqual(labels);
    expect(models.requireActiveRole).toHaveBeenCalledWith('user-1', 'model-1', ['owner', 'editor']);
    const request = runtime.suggestDocumentLabels.mock.calls[0][0];
    expect(request.actorUserId).toBe('user-1');
    expect(request.sources.map((source: { assetId: string }) => source.assetId)).toEqual(['a', 'b']);
    expect(request.sources[0]).toMatchObject({ workspaceId: 'workspace-1', originalName: 'a.pdf', uploaderUserId: 'u-2', indexingStatus: 'ready' });
  });

  it('refuses whole pages without a usable page span', async () => {
    const pdf = buildService();
    pdf.database.query.mockResolvedValue({ rows: [{}] });
    const pages = (span: { from: number; to?: number }) => pdf.service.preview('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1',
      fieldMappings: [{ sourceField: 'Body', targetAttribute: 'body', mode: 'extract', rules: { location: 'pages', pages: span } }], identityFields: [],
    });
    await expect(pages({ from: 3, to: 2 })).rejects.toThrow('whole pages');
    await expect(pages({ from: 1, to: 60 })).rejects.toThrow('whole pages');
  });

  it('previews a computed field for owners and editors only', async () => {
    const models = { requireActiveRole: jest.fn().mockResolvedValue({ id: 'model-1' }) };
    const runtime = { previewComputedField: jest.fn().mockResolvedValue({ results: [] }) };
    const service = new SemanticSourceMappingService({} as never, models as never, {} as never, runtime as never, {} as never);
    const dto = { computed: { input: { kind: 'file' as const, name: 'document_name' }, method: 'split' as const, delimiter: '_', part: 1 }, samples: ['a_b'] };
    await expect(service.previewComputed('user-1', 'model-1', dto)).resolves.toEqual({ results: [] });
    expect(models.requireActiveRole).toHaveBeenCalledWith('user-1', 'model-1', ['owner', 'editor']);
    expect(runtime.previewComputedField).toHaveBeenCalledWith(dto);
  });

  it('rejects reading rules outside a document, and reading anywhere without a pattern', async () => {
    const { service, database } = buildService('text/csv');
    database.query.mockResolvedValue({ rows: [{}] });
    await expect(service.preview('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1', assetKind: 'csv', sheetName: 'CSV',
      fieldMappings: [{ sourceField: 'id', targetAttribute: 'id', mode: 'direct', rules: { labels: ['Id'] } }], identityFields: [],
    })).rejects.toThrow('Reading rules');
    const pdf = buildService();
    pdf.database.query.mockResolvedValue({ rows: [{}] });
    await expect(pdf.service.preview('user-1', 'model-1', {
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1',
      fieldMappings: [{ sourceField: null, targetAttribute: 'id', mode: 'extract', rules: { location: 'anywhere' } }], identityFields: [],
    })).rejects.toThrow('needs a pattern');
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
