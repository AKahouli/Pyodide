import { describe, expect, it } from 'vitest';
import type { ConceptSourceMapping, MappingHealthItem, SemanticGraph } from '../types';
import { designerFlow, SOURCE_COLUMN_OFFSET, typedSourceId } from './designer-flow';

const concept = (id: string, x: number, attributes: string[]) => ({
  id, key: id, label: id, description: '', category: 'business_object' as const, recordPolicy: 'optional' as const,
  systemKey: null, aliases: [], position: { x, y: 100 },
  attributes: attributes.map((key) => ({ key, label: key, type: 'text' as const, required: false })),
});

const graph: SemanticGraph = {
  modelId: 'm', versionId: 'v', revision: 0, relations: [], recordRelations: [],
  nodes: [concept('supplier', 400, ['name', 'siret', 'country']), concept('contract', 800, ['number'])],
  records: [{ id: 'r1', nodeTypeId: 'supplier', label: 'Acme', values: {}, status: 'active', position: { x: 0, y: 0 } }],
};

const mapping = (id: string, conceptId: string, overrides: Partial<ConceptSourceMapping> = {}): ConceptSourceMapping => ({
  id, conceptId, workspaceId: 'w', documentId: 'suppliers', documentName: 'suppliers.xlsx', sheetName: 'Sheet1',
  assetKind: 'excel_sheet', status: 'ready', createdBy: '', createdAt: '', updatedAt: '', identityFields: ['siret'],
  fieldMappings: [
    { sourceField: 'Vendor', targetAttribute: 'name', mode: 'direct' },
    { sourceField: 'SIRET', targetAttribute: 'siret', mode: 'direct' },
    { sourceField: 'Notes', targetAttribute: 'country', mode: 'ignore' },
  ],
  ...overrides,
});

const health = (id: string, state: MappingHealthItem['state']) => ({ id, state } as MappingHealthItem);

describe('designerFlow', () => {
  it('groups mappings of one sheet into one source box, in a column left of every concept', () => {
    const { sources, feeds } = designerFlow(graph, [mapping('a', 'supplier'), mapping('b', 'contract')], [health('a', 'healthy'), health('b', 'healthy')]);
    const sheet = sources.find((source) => source.kind === 'spreadsheet')!;
    expect(sheet).toMatchObject({ label: 'suppliers.xlsx', detail: 'Sheet1', tone: 'ok', position: { x: 400 - SOURCE_COLUMN_OFFSET, y: 100 } });
    expect(feeds.filter((feed) => feed.sourceId === sheet.id).map((feed) => feed.conceptId)).toEqual(['supplier', 'contract']);
  });

  it('counts mapped fields and ignores skipped columns', () => {
    const { feeds } = designerFlow(graph, [mapping('a', 'supplier')], [health('a', 'healthy')]);
    expect(feeds[0]).toMatchObject({ step: 'map', mapped: 2, total: 3, tone: 'ok' });
  });

  it('flags a source without a unique field or with a changed file', () => {
    const { sources } = designerFlow(graph, [mapping('a', 'supplier', { identityFields: [] })], [health('a', 'healthy')]);
    expect(sources[0].tone).toBe('warn');
    expect(designerFlow(graph, [mapping('a', 'supplier')], [health('a', 'changed')]).sources[0].tone).toBe('warn');
  });

  it('shows typed records as their own source, below the files feeding the same concept', () => {
    const { sources, feeds } = designerFlow(graph, [mapping('a', 'supplier', { assetKind: 'document', sheetName: '' })]);
    expect(sources.map((source) => source.kind)).toEqual(['documents', 'typed']);
    const typed = sources.find((source) => source.id === typedSourceId('supplier'))!;
    expect(typed.position.y).toBeGreaterThan(sources[0].position.y);
    expect(sources.every((source) => source.position.x === 400 - SOURCE_COLUMN_OFFSET)).toBe(true);
    expect(feeds.find((feed) => feed.sourceId === typed.id)).toMatchObject({ step: 'typed', conceptId: 'supplier' });
    expect(feeds[0].step).toBe('extract');
  });

  it('skips mappings whose concept was deleted', () => {
    expect(designerFlow(graph, [mapping('a', 'gone')]).feeds.filter((feed) => feed.step !== 'typed')).toEqual([]);
  });
});
