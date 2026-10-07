import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSemanticModelEditorStore } from '../../store';
import type { DerivedSource, SemanticGraph } from '../../types';
import { DerivedSourceDrawer, suggestSourceField } from './DerivedSourceDrawer';
import { derivedPayload, derivedRows } from './derivedMapping';
import { readingKeys } from './readingText';

const api = vi.hoisted(() => ({
  listDerivedSources: vi.fn(), listIdentityRules: vi.fn(), conceptRecords: vi.fn(), previewDerivedFields: vi.fn(),
  saveDerivedSource: vi.fn(), deleteDerivedSource: vi.fn(), previewComputedField: vi.fn(),
  listMappingPresets: vi.fn(), getLastDocumentMapping: vi.fn(), getExtractionDefaults: vi.fn(),
}));
vi.mock('../../api', () => ({ semanticModelApi: api }));
vi.mock('@/modules/agent', () => ({ useAgents: () => [], useAgentStore: { getState: () => ({ isInitialized: true, isLoading: false, fetchAgents: vi.fn() }) } }));

const field = (key: string, label = key.replaceAll('_', ' ')) => ({ key, label });

describe('suggestSourceField', () => {
  const contract = [field('contract_number'), field('customer_id'), field('customer_name'), field('effective_date')];

  it('pairs a field with the source field whose name ends with it', () => {
    expect(suggestSourceField(field('id'), contract)).toBe('customer_id');
    expect(suggestSourceField(field('name'), contract)).toBe('customer_name');
  });

  it('prefers the same name, and suggests nothing without a match', () => {
    expect(suggestSourceField(field('contract_number'), contract)).toBe('contract_number');
    expect(suggestSourceField(field('country'), contract)).toBeUndefined();
  });

  it('reads labels too, and takes the shortest match', () => {
    expect(suggestSourceField({ key: 'raison_sociale', label: 'Name' }, [field('supplier_trade_name'), field('supplier_name')])).toBe('supplier_name');
  });
});

const attribute = (key: string, label: string) => ({ key, label, type: 'text' as const, required: false });
const graph: SemanticGraph = {
  modelId: 'model-1', versionId: 'version-1', revision: 0, relations: [], records: [], recordRelations: [],
  nodes: [
    { id: 'org', key: 'organization', label: 'Organization', description: '', category: 'business_object', recordPolicy: 'optional', systemKey: null, aliases: [],
      attributes: [attribute('id', 'ID'), attribute('name', 'Name'), attribute('country', 'Country')], position: { x: 0, y: 0 } },
    { id: 'contract', key: 'contract', label: 'Contract', description: '', category: 'business_object', recordPolicy: 'optional', systemKey: null, aliases: [],
      attributes: [attribute('customer_id', 'Customer ID'), attribute('customer_name', 'Customer name'), attribute('notes', 'Notes')], position: { x: 0, y: 0 } },
  ],
};
const saved: DerivedSource = {
  id: 'd-1', conceptId: 'org', sourceConceptId: 'contract', conflictRule: 'most_frequent', orderBy: null, updatedAt: '2026-09-30T00:00:00.000Z',
  fieldMappings: [{ sourceAttribute: 'customer_id', targetAttribute: 'id' }, { sourceAttribute: 'customer_name', targetAttribute: 'name' }],
};
const NOTES = 'Client: Acme\nPays: France';
const records = Array.from({ length: 10 }, (_, index) => ({
  id: `contract:k${index + 1}`, conceptId: 'contract', entityKey: `k${index + 1}`, label: `K-${index + 1}`,
  values: { customer_name: index ? `Customer ${index + 1}` : 'Acme', notes: index ? `Pays: Pays ${index + 1}` : NOTES },
  identity: { customer_id: `c-${index + 1}` },
}));

function renderDrawer(derived: DerivedSource | undefined = saved) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(<QueryClientProvider client={client}><DerivedSourceDrawer modelId='model-1' target={{ conceptId: 'org', derived }} onClose={vi.fn()} /></QueryClientProvider>);
}

/** The row of one field in the shared field list. */
const fieldRow = (label: string) => screen.getByText(label, { selector: 'span.truncate' }).closest('div.space-y-2') as HTMLElement;

describe('Derived source with the shared field mapping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSemanticModelEditorStore.getState().hydrate(graph);
    api.listDerivedSources.mockResolvedValue([saved]);
    api.listIdentityRules.mockResolvedValue([{ conceptId: 'org', fields: ['id'] }]);
    api.conceptRecords.mockResolvedValue({ dataRevisionId: 'r1', total: 42, offset: 0, limit: 20, records });
    api.saveDerivedSource.mockResolvedValue({ revision: 3, derivedSource: saved });
    api.previewDerivedFields.mockImplementation(async (_model: string, request: { records: Array<{ entityId: string }> }) => ({
      records: request.records.map((record) => ({ entityId: record.entityId, fields: {
        id: { method: 'direct', reason: 'found', value: 'c-1', column: 'customer_id' },
        ...(record.entityId === 'contract:k1'
          ? { country: { method: 'rules', reason: 'found', value: 'France', column: 'notes', span: { start: 19, end: 25 }, quote: NOTES } }
          : { country: { method: 'rules', reason: 'label_not_found', column: 'notes' } }),
      } })),
      ai: { aiRows: 0, aiCalls: 0, aiSkippedRows: 0, aiFailedRows: 0 },
    }));
  });

  it('renders the shared field list with the source concept fields as inputs', async () => {
    renderDrawer();
    await screen.findByText('Country', { selector: 'span.truncate' });
    expect(screen.getByText('derived.fields')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'mapping.readAll.label' })).toBeInTheDocument();
    const id = fieldRow('ID');
    expect(within(id).getByRole('combobox', { name: 'mapping.methodFor' })).toHaveTextContent('mapping.method.direct');
    // A source field is shown by its name.
    expect(within(id).getByRole('combobox', { name: 'derived.sourceFieldFor' })).toHaveTextContent('Customer ID');
    expect(within(fieldRow('Country')).getByRole('combobox', { name: 'mapping.methodFor' })).toHaveTextContent('mapping.method.ignore');
  });

  it('saves a derived source saved before the field modes exactly as it was', async () => {
    renderDrawer();
    await screen.findByText('Country', { selector: 'span.truncate' });
    fireEvent.click(screen.getByRole('button', { name: 'derived.save' }));
    await waitFor(() => expect(api.saveDerivedSource).toHaveBeenCalled());
    expect(api.saveDerivedSource.mock.calls[0][1]).toEqual({
      conceptId: 'org', sourceConceptId: 'contract', fieldMappings: saved.fieldMappings, identityFields: ['id'], conflictRule: 'most_frequent' });
    expect(api.saveDerivedSource.mock.calls[0][2]).toBe('d-1');
  });

  it('reopens a source expanding a field with its item fields, previews each item and saves the setting', async () => {
    const expand = { field: 'customer_name', split: 'delimiters' as const, delimiters: [','] };
    api.previewDerivedFields.mockResolvedValue({
      records: [{ entityId: 'contract:k1', item: 1, itemText: 'Acme', fields: { id: { method: 'direct', reason: 'found', value: 'Acme', column: '@item' } } },
        { entityId: 'contract:k1', item: 2, itemText: 'Globex', fields: { id: { method: 'direct', reason: 'found', value: 'Globex', column: '@item' } } }],
      ai: { aiRows: 0, aiCalls: 0, aiSkippedRows: 0, aiFailedRows: 0 }, itemFields: ['@item'], itemsTruncated: false,
    });
    renderDrawer({ ...saved, expand, fieldMappings: [{ sourceAttribute: '@item', targetAttribute: 'id' }, { sourceAttribute: '@item', targetAttribute: 'name' }] });
    await screen.findByText('Country', { selector: 'span.truncate' });
    // The item is offered beside the source fields, and the saved rows still read it.
    expect(within(fieldRow('ID')).getByRole('combobox', { name: 'derived.sourceFieldFor' })).toHaveTextContent('derived.expand.item');
    expect(screen.getByRole('switch', { name: /derived.expand.label/ })).toBeChecked();
    await waitFor(() => expect(api.previewDerivedFields).toHaveBeenCalled());
    const request = api.previewDerivedFields.mock.calls.at(-1)![1];
    expect(request.expand).toEqual(expand);
    // The source field the items come from is sent; the item itself is not a field of the record.
    expect(Object.keys(request.records[0].values)).toEqual(['customer_name']);
    expect(await screen.findByText('derived.expand.found')).toBeInTheDocument();
    expect(screen.getAllByText(/derived.expand.itemOf/)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'derived.save' }));
    await waitFor(() => expect(api.saveDerivedSource).toHaveBeenCalled());
    expect(api.saveDerivedSource.mock.calls[0][1]).toMatchObject({ expand });
  });

  it('asks for the field to expand before saving', async () => {
    renderDrawer();
    await screen.findByText('Country', { selector: 'span.truncate' });
    fireEvent.click(screen.getByRole('switch', { name: /derived.expand.label/ }));
    expect(await screen.findByText('derived.expand.problem.field')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'derived.save' })).toBeDisabled();
  });

  it('keeps the AI limits set for this source, and offers presets', async () => {
    api.listMappingPresets.mockResolvedValue([]);
    api.getExtractionDefaults.mockResolvedValue({ aiSettings: { maxBlocks: 120, maxCharacters: 60000, longDocumentCharacters: 40000, blocksPerField: 8 }, configured: {} });
    renderDrawer({ ...saved, aiSettings: { maxBlocks: 40 }, fieldMappings: [...saved.fieldMappings,
      { sourceAttribute: 'notes', targetAttribute: 'country', mode: 'extract', extractionStrategy: 'ai' }] });
    await screen.findByText('Country', { selector: 'span.truncate' });
    expect(screen.getByText('mapping.ai.title')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'mapping.presets.title' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'derived.save' }));
    await waitFor(() => expect(api.saveDerivedSource).toHaveBeenCalled());
    expect(api.saveDerivedSource.mock.calls[0][1]).toMatchObject({ aiSettings: { maxBlocks: 40 } });
  });

  it('picks the first five sample records, filters above eight, and previews each with its evidence', async () => {
    renderDrawer({ ...saved, fieldMappings: [...saved.fieldMappings, { sourceAttribute: 'notes', targetAttribute: 'country', mode: 'extract', extractionStrategy: 'deterministic', rules: { labels: ['Pays'] } }] });
    await screen.findByText('Country', { selector: 'span.truncate' });
    await waitFor(() => expect(screen.getAllByRole('checkbox', { name: 'derived.recordFor' })).toHaveLength(10));
    expect(screen.getAllByRole('checkbox', { name: 'derived.recordFor' }).filter((box) => (box as HTMLInputElement).checked)).toHaveLength(5);
    expect(screen.getByRole('textbox', { name: 'derived.recordsFilter' })).toBeInTheDocument();
    await waitFor(() => expect(api.previewDerivedFields).toHaveBeenCalled(), { timeout: 2000 });
    const request = api.previewDerivedFields.mock.calls[0][1];
    expect(request.records).toHaveLength(5);
    // A key field is only kept in the record's identity; it is sent as the source field's value.
    expect(request.records[0]).toEqual({ entityId: 'contract:k1', values: { customer_id: 'c-1', customer_name: 'Acme', notes: NOTES } });
    const result = await screen.findByRole('region', { name: 'derived.resultTitle' });
    // Each value names the source field and the record it was read on.
    expect(within(result).getAllByText('France')[0]).toBeInTheDocument();
    expect(within(result).getByText(/Notes · K-1 · Client: Acme/)).toBeInTheDocument();
    // A label missing from a record's field is worded for a record, not a document.
    expect(within(result).getAllByText('mapping.reading.in.record.reason.label_not_found').length).toBeGreaterThan(0);
  });

  it('saves the field modes with only what each one uses', async () => {
    renderDrawer();
    await screen.findByText('Country', { selector: 'span.truncate' });
    const country = fieldRow('Country');
    fireEvent.click(within(country).getByRole('combobox', { name: 'mapping.methodFor' }));
    fireEvent.click(await screen.findByRole('option', { name: 'mapping.method.extract' }));
    fireEvent.click(within(fieldRow('Country')).getByRole('combobox', { name: 'derived.sourceFieldFor' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Notes' }));
    fireEvent.click(within(fieldRow('Name')).getByRole('combobox', { name: 'mapping.methodFor' }));
    fireEvent.click(await screen.findByRole('option', { name: 'mapping.method.constant' }));
    fireEvent.change(within(fieldRow('Name')).getByRole('textbox', { name: 'mapping.constantPlaceholder' }), { target: { value: 'ACME' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'derived.save' })); });
    await waitFor(() => expect(api.saveDerivedSource).toHaveBeenCalled());
    expect(api.saveDerivedSource.mock.calls[0][1].fieldMappings).toEqual([
      { sourceAttribute: 'customer_id', targetAttribute: 'id' },
      { targetAttribute: 'name', mode: 'constant', constantValue: 'ACME' },
      { sourceAttribute: 'notes', targetAttribute: 'country', mode: 'extract', extractionStrategy: 'deterministic' },
    ]);
  });
});

describe('derived rows and payload', () => {
  const attributes = graph.nodes[0].attributes;
  it('reads saved fields back into rows and saves them unchanged', () => {
    const fields = [...saved.fieldMappings,
      { targetAttribute: 'country', mode: 'computed' as const, computed: { input: { kind: 'column' as const, name: 'notes' }, method: 'whole' as const, transform: 'upper' as const } }];
    const rows = derivedRows(fields, attributes, ['customer_id', 'customer_name', 'notes']);
    expect(rows.map((row) => row.mode)).toEqual(['direct', 'direct', 'computed']);
    expect(derivedPayload(rows, fields.map((item) => item.targetAttribute))).toEqual(fields);
  });

  it('leaves out a field whose source field was removed', () => {
    expect(derivedRows(saved.fieldMappings, attributes, ['customer_id']).map((row) => row.mode)).toEqual(['direct', 'ignore', 'ignore']);
  });
});

describe('not found wording', () => {
  it('names a document, a cell or a field of a record', () => {
    expect(readingKeys('document', 'label_not_found').reasonKey).toBe('mapping.reading.reason.label_not_found');
    expect(readingKeys('cell', 'label_not_found').reasonKey).toBe('mapping.reading.in.cell.reason.label_not_found');
    expect(readingKeys('record', 'no_input').hintKey).toBe('mapping.reading.in.record.hint.no_input');
    // Reasons that name nothing read the same everywhere.
    expect(readingKeys('record', 'no_value').reasonKey).toBe('mapping.reading.reason.no_value');
  });
});
