import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSemanticModelEditorStore } from '../../store';
import type { ConceptSourceMapping, SemanticGraph, SourceFieldMapping } from '../../types';
import { SourceMappingDrawer, type SourceMappingTarget } from './SourceMappingDrawer';
import { adaptToDocument, adaptToSheet, cellLabelSuggestions, newSheetRows, sheetPayload, sheetRows } from './sheetMapping';
import { readAllWith, withMode } from './FieldMappingList';

const api = vi.hoisted(() => ({
  listSourceMappings: vi.fn(), profileSourceAsset: vi.fn(), createSourceMapping: vi.fn(), previewSourceMapping: vi.fn(), analyzeSourceAsset: vi.fn(),
  previewComputedField: vi.fn(), previewSheetFields: vi.fn(), getExtractionDefaults: vi.fn(), listMappingPresets: vi.fn(), lastUsedMapping: vi.fn(),
}));
vi.mock('../../api', () => ({ semanticModelApi: api }));
vi.mock('@/modules/agent', () => ({ useAgents: () => [], useAgentStore: { getState: () => ({ isInitialized: true, isLoading: false, fetchAgents: vi.fn() }) } }));

const mapping: ConceptSourceMapping = {
  id: 'mapping-1', conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1', documentName: 'mails2.zip',
  sheetName: 'Message', assetKind: 'excel_sheet', fieldMappings: [{ sourceField: 'message_id', targetAttribute: 'id', mode: 'direct' }],
  status: 'ready', createdBy: 'user', createdAt: '', updatedAt: '', identityFields: ['id'],
};
const attributes = [
  { key: 'id', label: 'ID', type: 'text' as const, required: true },
  { key: 'reference', label: 'Référence', type: 'text' as const, required: false },
];
const graph: SemanticGraph = {
  modelId: 'model-1', versionId: 'version-1', revision: 0, relations: [], records: [], recordRelations: [],
  nodes: [{ id: 'concept-1', key: 'message', label: 'Message', description: '', category: 'business_object', recordPolicy: 'optional', systemKey: null, aliases: [], attributes, position: { x: 0, y: 0 } }],
};
const BODY = 'Bonjour,\nRéf: CMD-42\nMerci';
const profile = {
  sheets: [{ name: 'Message', rowCount: 120, fieldCount: 2 }], sheet: { name: 'Message', rowCount: 120, fieldCount: 2 }, complete: true,
  fields: [
    { name: 'message_id', type: 'text', sample: 'M1', populatedRatio: 1, uniqueRatio: 1 },
    { name: 'corps', type: 'text', sample: BODY, populatedRatio: 1, uniqueRatio: 1 },
  ],
  sampleRows: [{ __sheetRow: 2, message_id: 'M1', corps: BODY }, { __sheetRow: 3, message_id: 'M2', corps: 'Réf: CMD-7' }],
};
const target = (saved: ConceptSourceMapping = mapping): SourceMappingTarget =>
  ({ workspaceId: saved.workspaceId, documentId: saved.documentId, documentName: saved.documentName!, assetKind: saved.assetKind, conceptId: saved.conceptId, mapping: saved });

function renderDrawer(value: SourceMappingTarget = target()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(<QueryClientProvider client={client}><SourceMappingDrawer modelId='model-1' target={value} onClose={vi.fn()} /></QueryClientProvider>);
  return { invalidate };
}

/** The row of one field in the shared field list. */
const fieldRow = (label: string) => screen.getByText(label, { selector: 'span.truncate' }).closest('div.space-y-2') as HTMLElement;

describe('Sheet mapping with the document field mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSemanticModelEditorStore.getState().hydrate(graph);
    api.listSourceMappings.mockResolvedValue([mapping]);
    api.profileSourceAsset.mockResolvedValue(profile);
    api.createSourceMapping.mockResolvedValue({ revision: 2 });
    api.getExtractionDefaults.mockResolvedValue({ aiSettings: { maxBlocks: 400, maxCharacters: 60000, longDocumentCharacters: 30000, blocksPerField: 8 }, configured: {} });
    api.listMappingPresets.mockResolvedValue([]);
    api.lastUsedMapping.mockResolvedValue(null);
    api.previewSheetFields.mockResolvedValue({ rows: [], ai: { aiRows: 0, aiCalls: 0, aiSkippedRows: 0, aiFailedRows: 0 } });
  });

  it('switches a mapping to another spreadsheet in place: same sheet name, its fields fitted to the new columns', async () => {
    const onSaved = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    // The other file names its key column differently; the field still reads the column named like it.
    api.profileSourceAsset.mockResolvedValue({ ...profile, sheets: [{ name: 'Other', rowCount: 1, fieldCount: 1 }, { name: 'Message', rowCount: 3, fieldCount: 2 }],
      fields: [{ name: 'id', type: 'text', sample: 'X', populatedRatio: 1, uniqueRatio: 1 }, { name: 'corps', type: 'text', sample: BODY, populatedRatio: 1, uniqueRatio: 1 }] });
    const switched: SourceMappingTarget = { workspaceId: 'workspace-1', documentId: 'document-2', documentName: 'mails3.xlsx', assetKind: 'excel_sheet', conceptId: 'concept-1', replaces: mapping };
    render(<QueryClientProvider client={client}><SourceMappingDrawer modelId='model-1' target={switched} onClose={vi.fn()} onSaved={onSaved} /></QueryClientProvider>);
    expect(await screen.findByText('mapping.switch.title')).toBeInTheDocument();
    await screen.findByText('Référence', { selector: 'span.truncate' });
    fireEvent.click(screen.getByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(api.createSourceMapping).toHaveBeenCalled());
    expect(api.createSourceMapping.mock.calls[0][1]).toEqual(expect.objectContaining({
      mappingId: 'mapping-1', documentId: 'document-2', sheetName: 'Message', identityFields: ['id'],
      fieldMappings: [{ sourceField: 'id', targetAttribute: 'id', mode: 'direct' }],
    }));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('moves a sheet mapping to documents: columns read out of the document, recipes on columns start again, fixed values stay', () => {
    const recipe = { input: { kind: 'column' as const, name: 'a' }, method: 'whole' as const, transform: 'none' as const };
    const saved: SourceFieldMapping[] = [
      { sourceField: 'message_id', targetAttribute: 'id', mode: 'direct' },
      { sourceField: 'corps', targetAttribute: 'reference', mode: 'extract', extractionStrategy: 'ai', semanticDefinition: 'the order number' },
      { sourceField: null, targetAttribute: 'joined', mode: 'computed', computed: recipe },
      { sourceField: null, targetAttribute: 'kind', mode: 'constant', constantValue: 'mail' },
    ];
    expect(adaptToDocument(saved, [{ key: 'id' }, { key: 'reference' }, { key: 'joined' }, { key: 'kind' }, { key: 'unread' }])).toEqual([
      { sourceField: null, targetAttribute: 'id', mode: 'extract', extractionStrategy: 'deterministic' },
      { sourceField: null, targetAttribute: 'reference', mode: 'extract', extractionStrategy: 'ai', semanticDefinition: 'the order number' },
      { sourceField: null, targetAttribute: 'joined', mode: 'extract', extractionStrategy: 'deterministic' },
      { sourceField: null, targetAttribute: 'kind', mode: 'constant', constantValue: 'mail' },
      { sourceField: null, targetAttribute: 'unread', mode: 'ignore' },
    ]);
  });

  it('saves an old mapping exactly as it was, and refreshes the data preview', async () => {
    const { invalidate } = renderDrawer();
    await screen.findByText('Référence', { selector: 'span.truncate' });
    fireEvent.click(screen.getByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(api.createSourceMapping).toHaveBeenCalled());
    expect(api.createSourceMapping.mock.calls[0][1].fieldMappings).toEqual(mapping.fieldMappings);
    expect(api.createSourceMapping.mock.calls[0][1]).not.toHaveProperty('aiSettings');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['semantic-models', 'data-preview', 'model-1'] });
    expect(useSemanticModelEditorStore.getState().graph?.revision).toBe(0);
  });

  it('shows the document field mapping for every concept field, with the sheet modes', async () => {
    renderDrawer();
    await screen.findByText('Référence', { selector: 'span.truncate' });
    expect(screen.getByText('mapping.cell.fieldsTitle')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'mapping.readAll.label' })).toBeInTheDocument();
    expect(screen.getByText('mapping.presets.startFrom')).toBeInTheDocument();
    // The field read from its column shows that column; the other is left out.
    expect(within(fieldRow('ID')).getByRole('combobox', { name: 'mapping.cell.columnFor' })).toHaveTextContent('message_id');
    const modes = within(fieldRow('Référence')).getByRole('combobox', { name: 'mapping.methodFor' });
    fireEvent.click(modes);
    for (const mode of ['direct', 'extract', 'computed', 'constant', 'ignore']) expect(await screen.findByRole('option', { name: `mapping.method.${mode}` })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'mapping.method.metadata' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'mapping.method.extract' }));
    // Extracted from a column: choose the column, then the same rules and AI as a document field.
    const row = fieldRow('Référence');
    expect(within(row).getByText('mapping.cell.noColumn')).toBeInTheDocument();
    expect(within(row).getByRole('combobox', { name: 'mapping.strategyFor' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: /mapping\.rules\.title/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'mapping.save' })).toBeDisabled();
  });

  it('saves a value extracted from a cell with rules, and reads the picked rows for it', async () => {
    api.previewSheetFields.mockResolvedValue({ rows: [
      { rowNumber: 2, fields: { id: { method: 'direct', reason: 'found', value: 'M1', column: 'message_id' },
        reference: { method: 'rules', reason: 'found', value: 'CMD-42', column: 'corps', quote: 'Réf: CMD-42', span: { start: 14, end: 20 } } } },
      { rowNumber: 3, fields: { reference: { method: 'rules', reason: 'label_not_found', column: 'corps' } } },
    ], ai: { aiRows: 0, aiCalls: 0, aiSkippedRows: 0, aiFailedRows: 0 } });
    const saved = { ...mapping, fieldMappings: [...mapping.fieldMappings, { sourceField: 'corps', targetAttribute: 'reference', mode: 'extract' as const,
      extractionStrategy: 'deterministic' as const, rules: { labels: ['Réf'] } }] };
    renderDrawer(target(saved));
    await waitFor(() => expect(api.previewSheetFields).toHaveBeenCalled(), { timeout: 2000 });
    expect(api.previewSheetFields.mock.calls[0][1]).toEqual({
      conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1', fieldMappings: saved.fieldMappings,
      rows: [{ rowNumber: 2, values: { message_id: 'M1', corps: BODY } }, { rowNumber: 3, values: { message_id: 'M2', corps: 'Réf: CMD-7' } }],
    });
    // The value found on the shown row, the cell it was found in, and every picked row's result.
    expect(await screen.findAllByText('CMD-42')).not.toHaveLength(0);
    expect(screen.getByLabelText('mapping.cell.cellOf').querySelector('mark')?.textContent).toBe('CMD-42');
    expect(screen.getByText('mapping.cell.resultTitle')).toBeInTheDocument();
    // A label missing from a cell is worded for a cell, not a document.
    expect(screen.getByText('mapping.reading.in.cell.reason.label_not_found')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(api.createSourceMapping).toHaveBeenCalled());
    expect(api.createSourceMapping.mock.calls[0][1].fieldMappings).toEqual(saved.fieldMappings);
  });

  it('makes several records per row: the column split into items, fields reading the item, saved with the split', async () => {
    api.profileSourceAsset.mockResolvedValue({ ...profile, fields: [...profile.fields, { name: 'to', type: 'text', sample: 'a@x.fr; b@y.fr', populatedRatio: 1, uniqueRatio: 1 }],
      sampleRows: [{ __sheetRow: 2, message_id: 'M1', corps: BODY, to: 'a@x.fr; b@y.fr' }] });
    api.previewSheetFields.mockResolvedValue({ rows: [
      { rowNumber: 2, item: 1, itemText: 'a@x.fr', fields: { id: { method: 'direct', reason: 'found', value: 'a@x.fr', column: '@item' } } },
      { rowNumber: 2, item: 2, itemText: 'b@y.fr', fields: { id: { method: 'direct', reason: 'found', value: 'b@y.fr', column: '@item' } } },
    ], ai: { aiRows: 0, aiCalls: 0, aiSkippedRows: 0, aiFailedRows: 0 }, itemFields: ['@item'], itemsTruncated: false });
    const saved: ConceptSourceMapping = { ...mapping, fieldMappings: [{ sourceField: '@item', targetAttribute: 'id', mode: 'direct' }],
      expand: { field: 'to', split: 'auto' } };
    renderDrawer(target(saved));
    await waitFor(() => expect(api.previewSheetFields).toHaveBeenCalled(), { timeout: 2000 });
    // The item is not a column: the column it is split from is sent, with how to split it.
    expect(api.previewSheetFields.mock.calls[0][1]).toEqual(expect.objectContaining({
      rows: [{ rowNumber: 2, values: { to: 'a@x.fr; b@y.fr' } }], expand: { field: 'to', split: 'auto' } }));
    expect(await screen.findByText('derived.expand.row.found')).toBeInTheDocument();
    expect(screen.getAllByText(/derived\.expand\.row\.itemOf/)).toHaveLength(2);
    expect(within(fieldRow('ID')).getByRole('combobox', { name: 'mapping.cell.columnFor' })).toHaveTextContent('derived.expand.item');
    fireEvent.click(screen.getByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(api.createSourceMapping).toHaveBeenCalled());
    expect(api.createSourceMapping.mock.calls[0][1]).toEqual(expect.objectContaining({
      fieldMappings: saved.fieldMappings, expand: { field: 'to', split: 'auto' } }));

    // Turned off, a field still reading the item blocks saving.
    fireEvent.click(screen.getByRole('switch', { name: 'derived.expand.row.label' }));
    expect(await screen.findByText('derived.expand.row.itemWithoutExpand')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'mapping.save' })).toBeDisabled();
  });

  it('reads every field with rules in one click, and directly again', async () => {
    renderDrawer();
    await screen.findByText('Référence', { selector: 'span.truncate' });
    fireEvent.click(within(screen.getByRole('group', { name: 'mapping.readAll.label' })).getByRole('button', { name: /mapping\.strategy\.rules_then_ai/ }));
    expect(within(fieldRow('ID')).getByRole('combobox', { name: 'mapping.strategyFor' })).toHaveTextContent('mapping.strategy.rules_then_ai');
    expect(screen.getByText('mapping.cell.aiEstimate')).toBeInTheDocument();
    // AI is slow and costly: the rows are only read with it on request.
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 700)); });
    expect(api.previewSheetFields).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('group', { name: 'mapping.readAll.label' })).getByRole('button', { name: /mapping\.cell\.readAllDirect/ }));
    fireEvent.click(screen.getByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(api.createSourceMapping).toHaveBeenCalled());
    expect(api.createSourceMapping.mock.calls[0][1].fieldMappings).toEqual(mapping.fieldMappings);
  });

  it('reads a newly uploaded spreadsheet by itself, without asking for an analysis', async () => {
    api.profileSourceAsset.mockRejectedValue(new Error('This source has not been analyzed yet'));
    api.analyzeSourceAsset.mockResolvedValue({ sheets: [{ name: 'Customers', rowCount: 3, fieldCount: 2 }], fields: [] });
    renderDrawer({ workspaceId: 'workspace-1', documentId: 'document-2', documentName: 'customers.xlsx', assetKind: 'excel_sheet' });
    await waitFor(() => expect(api.analyzeSourceAsset).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'sourceAnalysis.retry' })).not.toBeInTheDocument();
  });
});

describe('sheet mapping rows', () => {
  const recipe = { input: { kind: 'column' as const, name: 'corps' }, method: 'between' as const, after: 'Réf: ', transform: 'none' as const };

  it('build one row per field, and save what the old drawer saved', () => {
    expect(newSheetRows(attributes, ['ID', 'reference', 'other'])).toEqual([
      { sourceField: 'ID', targetAttribute: 'id', mode: 'direct' },
      { sourceField: 'reference', targetAttribute: 'reference', mode: 'direct' },
    ]);
    const saved: SourceFieldMapping[] = [{ sourceField: 'b', targetAttribute: 'reference', mode: 'direct' }, { sourceField: 'a', targetAttribute: 'id', mode: 'direct' }];
    // Saved order is kept: a sheet's label is its first field read from a column.
    expect(sheetPayload(sheetRows(saved, attributes), ['reference', 'id'])).toEqual(saved);
    expect(sheetRows([{ sourceField: 'corps', targetAttribute: 'reference', mode: 'direct', computed: recipe }], attributes)[1])
      .toEqual({ sourceField: null, targetAttribute: 'reference', mode: 'computed', computed: recipe });
  });

  it('switch modes keeping the column, and keep only what each mode uses', () => {
    const direct: SourceFieldMapping = { sourceField: 'corps', targetAttribute: 'reference', mode: 'direct' };
    const extracted = withMode(direct, 'extract', 'sheet');
    expect(extracted).toEqual({ sourceField: 'corps', targetAttribute: 'reference', mode: 'extract', extractionStrategy: 'deterministic' });
    expect(withMode({ ...extracted, extractionStrategy: 'ai', semanticDefinition: 'x' }, 'direct', 'sheet')).toEqual(direct);
    expect(withMode(direct, 'computed', 'sheet').computed?.input).toEqual({ kind: 'column', name: 'corps' });
    expect(withMode(withMode(direct, 'computed', 'sheet'), 'extract', 'sheet').sourceField).toBe('corps');
    expect(readAllWith([direct, { sourceField: null, targetAttribute: 'id', mode: 'constant', constantValue: 'x' }], 'ai', 'sheet'))
      .toEqual([{ ...extracted, extractionStrategy: 'ai' }, { sourceField: null, targetAttribute: 'id', mode: 'constant', constantValue: 'x' }]);
  });

  it('apply a document preset to a sheet with this sheet columns', () => {
    const rows = sheetRows(mapping.fieldMappings, attributes);
    const applied = adaptToSheet([
      { sourceField: null, targetAttribute: 'reference', mode: 'extract', extractionStrategy: 'rules_then_ai', rules: { labels: ['Réf'] } },
      { sourceField: 'document_name', targetAttribute: 'id', mode: 'metadata' },
    ], rows, attributes, ['message_id', 'Reference']);
    expect(applied[0]).toEqual(rows[0]);
    expect(applied[1]).toEqual({ sourceField: 'Reference', targetAttribute: 'reference', mode: 'extract', extractionStrategy: 'rules_then_ai', rules: { labels: ['Réf'] } });
  });

  it('suggest the labels that start lines in the cells', () => {
    const labels = cellLabelSuggestions(['Réf: A\nDate : 2026', 'Réf: B', 'see http://x']);
    expect(labels.map((item) => [item.label, item.documents])).toEqual([['Réf', 2], ['Date', 1]]);
  });
});
