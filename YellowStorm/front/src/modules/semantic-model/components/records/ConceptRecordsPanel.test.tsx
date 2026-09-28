import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSemanticModelEditorStore } from '../../store';
import type { SemanticGraph } from '../../types';
import { ConceptRecordsPanel } from './ConceptRecordsPanel';

const api = vi.hoisted(() => ({ conceptRecords: vi.fn(), listSourceMappings: vi.fn() }));
vi.mock('../../api', () => ({ semanticModelApi: api }));

const graph: SemanticGraph = {
  modelId: 'model-1', versionId: 'v', revision: 0, relations: [], records: [], recordRelations: [],
  nodes: [{ id: 'customer', key: 'customer', label: 'Customer', description: '', category: 'business_object', recordPolicy: 'optional', systemKey: null, aliases: [],
    attributes: [{ key: 'customer_id', label: 'Customer id', type: 'text', required: false }, { key: 'country', label: 'Country', type: 'text', required: false }],
    position: { x: 0, y: 0 } }],
};
const origin = { mappingId: 'm1', source: { kind: 'excel_sheet' as const, documentName: 'customers.xlsx', sheetName: 'Customers' }, rowNumber: 4 };
const record = (index: number) => ({
  id: `e${index}`, conceptId: 'customer', entityKey: `e${index}`, label: `Acme ${index}`,
  values: { country: 'FR' }, identity: { customer_id: `c${index}` }, provenance: { country: origin }, conflicts: [],
});

const renderPanel = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
  <ConceptRecordsPanel modelId='model-1' conceptId='customer' onClose={vi.fn()} />
</QueryClientProvider>);

describe('ConceptRecordsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSemanticModelEditorStore.getState().hydrate(graph);
    api.listSourceMappings.mockResolvedValue([
      { id: 'm1', conceptId: 'customer', workspaceId: 'w', documentId: 'd', documentName: 'customers.xlsx', sheetName: 'Customers', assetKind: 'excel_sheet', fieldMappings: [], status: 'ready', createdBy: '', createdAt: '', updatedAt: '', identityFields: [] },
      { id: 'm2', conceptId: 'customer', workspaceId: 'w', documentId: 'workspace:w:all', documentName: 'Legal', sheetName: '', assetKind: 'document', fieldMappings: [], status: 'ready', createdBy: '', createdAt: '', updatedAt: '', identityFields: [], scope: 'workspace', fileCount: 1200 },
    ]);
    api.conceptRecords.mockResolvedValue({ dataRevisionId: 'dr', total: 120, offset: 0, limit: 50, records: [record(1), record(2)] });
  });

  it('lists every field of the records, with the key value and where each value came from', async () => {
    renderPanel();
    expect(await screen.findByText('Acme 1')).toBeInTheDocument();
    expect(screen.getByText('c1')).toHaveAttribute('title', 'records.table.keyValue');
    expect(screen.getAllByText('FR')[0]).toHaveAttribute('title', expect.stringContaining('customers.xlsx · Customers · records.table.row'));
    // The sources feeding the concept sit in the header, a workspace with its file count.
    expect(await screen.findByText('Legal')).toBeInTheDocument();
    expect(screen.getByText(/records.table.files/)).toBeInTheDocument();
    expect(screen.getByText('records.table.range')).toBeInTheDocument();
  });

  it('searches as the person types, and pages through the results', async () => {
    renderPanel();
    await screen.findByText('Acme 1');
    vi.useFakeTimers();
    fireEvent.change(screen.getByRole('textbox', { name: 'records.table.search' }), { target: { value: ' acme ' } });
    await act(async () => { vi.advanceTimersByTime(350); });
    vi.useRealTimers();
    await waitFor(() => expect(api.conceptRecords).toHaveBeenLastCalledWith('model-1', 'customer', { q: 'acme', limit: 50, offset: 0 }));
    fireEvent.click(screen.getByRole('button', { name: 'records.table.next' }));
    await waitFor(() => expect(api.conceptRecords).toHaveBeenLastCalledWith('model-1', 'customer', { q: 'acme', limit: 50, offset: 50 }));
  });

  it('says when no data has been generated yet', async () => {
    api.conceptRecords.mockResolvedValue({ dataRevisionId: null, total: 0, offset: 0, limit: 50, records: [] });
    renderPanel();
    expect(await screen.findByText('records.table.noData')).toBeInTheDocument();
  });
});
