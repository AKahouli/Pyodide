import * as ExcelJS from 'exceljs';
import type { DocumentService } from '@modules/document/document.service';
import type { WorkspaceDocumentService } from '@modules/workspace/workspace-document.service';
import {
  computeFieldProfiles,
  identityKeyOf,
  normalizeIdentityValue,
  resolveSheetEntities,
  SHEET_ROW_KEY,
  suggestFieldMappings,
} from '../domain/semantic-source-mapping.types';
import { SpreadsheetConceptResolver } from './spreadsheet-concept.resolver';
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

describe('SpreadsheetConceptResolver.parse', () => {
  const buildService = () => new SpreadsheetConceptResolver(
    { findById: jest.fn() } as unknown as WorkspaceDocumentService,
    { download: jest.fn() } as unknown as DocumentService,
  );

  const withSheet = async (mimeType: string, build: (workbook: ExcelJS.Workbook) => Promise<Buffer>, size = 10) => {
    const workbook = new ExcelJS.Workbook();
    const buffer = await build(workbook);
    const service = buildService();
    (service as unknown as { documents: WorkspaceDocumentService }).documents.findById = jest.fn().mockResolvedValue({
      id: 'doc-1', mimeType, path: 'ws/doc-1', size,
    });
    (service as unknown as { storage: DocumentService }).storage.download = jest.fn().mockResolvedValue(buffer);
    return service;
  };

  const parse = (service: SpreadsheetConceptResolver, sheetName?: string) => service.parse('ws', 'doc-1', sheetName);

  it('parses an xlsx buffer into header-keyed rows and sheet metadata', async () => {
    const service = await withSheet('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', async (workbook) => {
      const sheet = workbook.addWorksheet('Customers');
      sheet.addRow(['customer_id', 'legal_name']);
      sheet.addRow(['C001', 'Sony Europe B.V.']);
      sheet.addRow(['C002', 'Sony France SAS']);
      workbook.addWorksheet('Contacts').addRow(['x']);
      return Buffer.from(await workbook.xlsx.writeBuffer());
    });

    const result = await parse(service);

    expect(result.sheets).toEqual([
      { name: 'Customers', rowCount: 3, fieldCount: 2 },
      { name: 'Contacts', rowCount: 1, fieldCount: 1 },
    ]);
    expect(result.rows).toEqual([
      { customer_id: 'C001', legal_name: 'Sony Europe B.V.', [SHEET_ROW_KEY]: 2 },
      { customer_id: 'C002', legal_name: 'Sony France SAS', [SHEET_ROW_KEY]: 3 },
    ]);
  });

  it('resolves rows from the requested sheet, not the first one', async () => {
    const service = await withSheet('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', async (workbook) => {
      const customers = workbook.addWorksheet('Customers');
      customers.addRow(['customer_id']);
      customers.addRow(['C001']);
      const amendments = workbook.addWorksheet('Amendments');
      amendments.addRow(['contract_number', 'amendment_number']);
      amendments.addRow(['SONY-01', 2]);
      amendments.addRow(['SONY-01', 3]);
      return Buffer.from(await workbook.xlsx.writeBuffer());
    });

    const result = await parse(service, 'Amendments');

    expect(result.sheets.map((sheet) => sheet.name)).toEqual(['Customers', 'Amendments']);
    expect(result.rows).toEqual([
      { contract_number: 'SONY-01', amendment_number: 2, [SHEET_ROW_KEY]: 2 },
      { contract_number: 'SONY-01', amendment_number: 3, [SHEET_ROW_KEY]: 3 },
    ]);
    await expect(parse(service, 'Missing')).rejects.toThrow();
  });

  it('names the implicit CSV sheet so it can be selected', async () => {
    const service = await withSheet('text/csv', async () => Buffer.from('customer_id,legal_name\nC001,Sony\n'));
    const result = await parse(service, 'CSV');
    expect(result.sheets[0].name).toBe('CSV');
    expect(result.rows).toEqual([{ customer_id: 'C001', legal_name: 'Sony', [SHEET_ROW_KEY]: 2 }]);
  });

  it('rejects oversized files before downloading', async () => {
    const service = await withSheet('text/csv', async () => Buffer.from('a\n1\n'), 60 * 1024 * 1024);
    const storage = (service as unknown as { storage: DocumentService }).storage.download as jest.Mock;
    await expect(parse(service)).rejects.toThrow('too large');
    expect(storage).not.toHaveBeenCalled();
  });
});

describe('SemanticSourceMappingService boundaries', () => {
  const buildService = (mimeType = 'application/pdf') => {
    const database = { query: jest.fn() };
    const models = {
      requireRole: jest.fn().mockResolvedValue({ id: 'model-1', currentDraftVersionId: 'version-1' }),
      requireActiveRole: jest.fn().mockResolvedValue({ id: 'model-1', currentDraftVersionId: 'version-1' }),
    };
    const documents = { findById: jest.fn().mockResolvedValue({ id: 'document-1', mimeType, originalName: 'Source.pdf' }), findByIds: jest.fn() };
    const service = new SemanticSourceMappingService(
      database as never,
      models as never,
      documents as never,
      { preview: jest.fn() } as never,
      { preview: jest.fn() } as never,
    );
    return { service, database, models, documents };
  };

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

    await expect(service.resolveConfigured('viewer', 'model-1')).resolves.toMatchObject({
      incompleteConceptIds: ['concept-1'],
      issues: [{ mappingId: 'mapping-1', code: 'source_unavailable' }],
    });
  });

  it('marks a disconnected mapping incomplete without accessing its document', async () => {
    const { service, database, documents } = buildService();
    database.query.mockResolvedValue({ rows: [{
      id: 'mapping-1', conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1',
      sheetName: '', assetKind: 'document', fieldMappings: [], identityFields: [], status: 'ready', sourceEnabled: false,
    }] });

    await expect(service.resolveConfigured('viewer', 'model-1')).resolves.toMatchObject({
      entities: [],
      incompleteConceptIds: ['concept-1'],
      issues: [{ mappingId: 'mapping-1', code: 'source_unavailable' }],
    });
    expect(documents.findById).not.toHaveBeenCalled();
  });
});
