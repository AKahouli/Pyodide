import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSemanticModelEditorStore } from '../../store';
import type { ConceptSourceMapping, SemanticGraph } from '../../types';
import { SourceMappingDrawer } from './SourceMappingDrawer';

const api = vi.hoisted(() => ({
  listSourceMappings: vi.fn(), profileSourceAsset: vi.fn(), createSourceMapping: vi.fn(), previewSourceMapping: vi.fn(), analyzeSourceAsset: vi.fn(),
  previewComputedField: vi.fn(),
}));
vi.mock('../../api', () => ({ semanticModelApi: api }));

const mapping: ConceptSourceMapping = {
  id: 'mapping-1', conceptId: 'concept-1', workspaceId: 'workspace-1', documentId: 'document-1', documentName: 'contracts.csv',
  sheetName: 'Contracts', assetKind: 'csv', fieldMappings: [{ sourceField: 'contract_id', targetAttribute: 'id', mode: 'direct' }],
  status: 'broken', createdBy: 'user', createdAt: '', updatedAt: '', identityFields: ['id'],
};
const graph: SemanticGraph = {
  modelId: 'model-1', versionId: 'version-1', revision: 0, relations: [], records: [], recordRelations: [],
  nodes: [{ id: 'concept-1', key: 'contract', label: 'Contract', description: '', category: 'business_object', recordPolicy: 'optional', systemKey: null, aliases: [], attributes: [{ key: 'id', label: 'ID', type: 'text', required: true }], position: { x: 0, y: 0 } }],
};

describe('SourceMappingDrawer repair', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSemanticModelEditorStore.getState().hydrate(graph);
    api.listSourceMappings.mockResolvedValue([mapping]);
    api.profileSourceAsset.mockResolvedValue({ sheets: [{ name: 'Contracts', rowCount: 1, fieldCount: 1 }], fields: [{ name: 'contract_id', type: 'text', sample: 'C1', populatedRatio: 1, uniqueRatio: 1 }] });
    api.createSourceMapping.mockResolvedValue({ revision: 2 });
  });

  it('invalidates Data Preview after a repaired mapping is saved', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(<QueryClientProvider client={client}><SourceMappingDrawer modelId='model-1' target={{ workspaceId: mapping.workspaceId, documentId: mapping.documentId, documentName: mapping.documentName!, assetKind: mapping.assetKind, conceptId: mapping.conceptId, mapping }} onClose={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(api.createSourceMapping).toHaveBeenCalled());
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['semantic-models', 'data-preview', 'model-1'] });
  });

  it('keeps the graph revision: a mapping advances the model revision, a separate counter from graph saves', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><SourceMappingDrawer modelId='model-1' target={{ workspaceId: mapping.workspaceId, documentId: mapping.documentId, documentName: mapping.documentName!, assetKind: mapping.assetKind, conceptId: mapping.conceptId, mapping }} onClose={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(api.createSourceMapping).toHaveBeenCalled());
    expect(useSemanticModelEditorStore.getState().graph?.revision).toBe(0);
  });

  it('lists the sheet columns a saved mapping left out, unmapped, and saves only the mapped ones', async () => {
    api.profileSourceAsset.mockResolvedValue({ sheets: [{ name: 'Contracts', rowCount: 1, fieldCount: 2 }], fields: [
      { name: 'contract_id', type: 'text', sample: 'C1', populatedRatio: 1, uniqueRatio: 1 },
      { name: 'destinataires', type: 'text', sample: 'a@b.fr, c@d.fr', populatedRatio: 1, uniqueRatio: 0.5 },
    ] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><SourceMappingDrawer modelId='model-1' target={{ workspaceId: mapping.workspaceId, documentId: mapping.documentId, documentName: mapping.documentName!, assetKind: mapping.assetKind, conceptId: mapping.conceptId, mapping }} onClose={vi.fn()} /></QueryClientProvider>);
    expect(await screen.findByText('destinataires')).toBeInTheDocument();
    expect(screen.getByText('a@b.fr, c@d.fr')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(api.createSourceMapping).toHaveBeenCalled());
    expect(api.createSourceMapping.mock.calls[0][1].fieldMappings).toEqual(mapping.fieldMappings);
  });

  it('opens the transformation of a mapped field, and saves its recipe only once it changes the value', async () => {
    api.profileSourceAsset.mockResolvedValue({ sheets: [{ name: 'Contracts', rowCount: 2, fieldCount: 1 }],
      fields: [{ name: 'contract_id', type: 'text', sample: 'C-1', populatedRatio: 1, uniqueRatio: 1 }],
      sampleRows: [{ __sheetRow: 2, contract_id: 'C-1' }, { __sheetRow: 3, contract_id: 'C-2' }] });
    api.previewComputedField.mockResolvedValue({ results: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><SourceMappingDrawer modelId='model-1' target={{ workspaceId: mapping.workspaceId, documentId: mapping.documentId, documentName: mapping.documentName!, assetKind: mapping.assetKind, conceptId: mapping.conceptId, mapping }} onClose={vi.fn()} /></QueryClientProvider>);
    // A field read as it is shows just its column: no step chip, the editor folded away.
    const edit = await screen.findByRole('button', { name: 'mapping.recipe.edit' });
    expect(screen.queryByText('mapping.recipe.chip')).not.toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'mapping.computed.editorFor' })).not.toBeInTheDocument();
    fireEvent.click(edit);
    expect(screen.getByRole('group', { name: 'mapping.computed.editorFor' })).toBeInTheDocument();
    // Opening it changes nothing: the old shape is saved.
    fireEvent.click(screen.getByRole('button', { name: 'mapping.rules.transform' }));
    fireEvent.click(screen.getByRole('radio', { name: 'mapping.rules.transformOption.upper' }));
    expect(screen.getByText('mapping.recipe.chip')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(api.createSourceMapping).toHaveBeenCalled());
    expect(api.createSourceMapping.mock.calls[0][1].fieldMappings).toEqual([{ sourceField: 'contract_id', targetAttribute: 'id', mode: 'direct',
      computed: { input: { kind: 'column', name: 'contract_id' }, method: 'whole', transform: 'upper' } }]);
  });

  it('reads a saved recipe back, and drops it when the column is read as it is again', async () => {
    const recipe = { input: { kind: 'column' as const, name: 'contract_id' }, method: 'split' as const, delimiter: '-', part: 2, transform: 'none' as const };
    const saved = { ...mapping, fieldMappings: [{ sourceField: 'contract_id', targetAttribute: 'id', mode: 'direct' as const, computed: recipe }] };
    api.previewComputedField.mockResolvedValue({ results: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><SourceMappingDrawer modelId='model-1' target={{ workspaceId: saved.workspaceId, documentId: saved.documentId, documentName: saved.documentName!, assetKind: saved.assetKind, conceptId: saved.conceptId, mapping: saved }} onClose={vi.fn()} /></QueryClientProvider>);
    expect(await screen.findByText('mapping.recipe.chip')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mapping.recipe.edit' }));
    fireEvent.click(screen.getByRole('button', { name: 'mapping.recipe.reset' }));
    expect(screen.queryByText('mapping.recipe.chip')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(api.createSourceMapping).toHaveBeenCalled());
    expect(api.createSourceMapping.mock.calls[0][1].fieldMappings).toEqual(mapping.fieldMappings);
  });

  it('reads a newly uploaded spreadsheet by itself, without asking for an analysis', async () => {
    api.profileSourceAsset.mockRejectedValue(new Error('This source has not been analyzed yet'));
    api.analyzeSourceAsset.mockResolvedValue({ sheets: [{ name: 'Customers', rowCount: 3, fieldCount: 2 }], fields: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><SourceMappingDrawer modelId='model-1' target={{ workspaceId: 'workspace-1', documentId: 'document-2', documentName: 'customers.xlsx', assetKind: 'excel_sheet' }} onClose={vi.fn()} /></QueryClientProvider>);
    await waitFor(() => expect(api.analyzeSourceAsset).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('button', { name: 'sourceAnalysis.retry' })).not.toBeInTheDocument();
  });
});
