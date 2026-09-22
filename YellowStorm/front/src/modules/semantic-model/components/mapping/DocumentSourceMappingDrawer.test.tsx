import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSemanticModelEditorStore } from '../../store';
import type { SemanticGraph } from '../../types';
import { DocumentSourceMappingDrawer } from './DocumentSourceMappingDrawer';

const api = vi.hoisted(() => ({
  listSourceAssets: vi.fn(),
  listSourceMappings: vi.fn(),
  previewSourceMapping: vi.fn(),
  createSourceMapping: vi.fn(),
  createBulkDocumentSourceMappings: vi.fn(),
}));

vi.mock('../../api', () => ({ semanticModelApi: api }));

const graph: SemanticGraph = {
  modelId: 'model-1', versionId: 'version-1', revision: 0, relations: [], records: [], recordRelations: [],
  nodes: [{ id: 'concept-1', key: 'contract', label: 'Contract', description: '', category: 'business_object', recordPolicy: 'none', systemKey: null, aliases: [], attributes: [
    { key: 'contract_number', label: 'Contract number', type: 'text', required: true },
    { key: 'amendment_number', label: 'Amendment number', type: 'text', required: true },
  ], position: { x: 0, y: 0 } }],
};

describe('DocumentSourceMappingDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSemanticModelEditorStore.getState().hydrate(graph);
    api.listSourceMappings.mockResolvedValue([]);
    api.listSourceAssets.mockResolvedValue({ assets: [
      { workspaceId: 'workspace-1', documentId: 'document-1', name: 'One.pdf', kind: 'document', mimeType: 'application/pdf', path: 'one.pdf' },
      { workspaceId: 'workspace-1', documentId: 'document-2', name: 'Two.pdf', kind: 'document', mimeType: 'application/pdf', path: 'two.pdf' },
    ] });
    api.previewSourceMapping.mockResolvedValue({ entities: [], stats: { scannedRows: 1, resolvedEntities: 0, duplicateKeysSkipped: 0, nullIdentitySkipped: 0 }, identityEvidence: [], warnings: [] });
    api.createBulkDocumentSourceMappings.mockResolvedValue({ revision: 1, mappingCount: 2 });
  });

  it('previews representative documents and saves one bulk mapping', async () => {
    let finishFirst!: (value: object) => void;
    api.previewSourceMapping
      .mockImplementationOnce(() => new Promise((resolve) => { finishFirst = resolve; }))
      .mockResolvedValueOnce({ entities: [], stats: { scannedRows: 1, resolvedEntities: 0, duplicateKeysSkipped: 0, nullIdentitySkipped: 0 }, identityEvidence: [], warnings: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    render(<QueryClientProvider client={client}><DocumentSourceMappingDrawer modelId='model-1' target={{
      workspaceId: 'workspace-1', documentId: 'document-1', documentName: 'One.pdf', assetKind: 'document', conceptId: 'concept-1', mimeType: 'application/pdf', path: 'one.pdf',
    }} onClose={vi.fn()} /></QueryClientProvider>);

    await screen.findByText('Two.pdf');
    const checkboxes = screen.getAllByRole('checkbox');
    fireEvent.click(checkboxes[1]);
    fireEvent.click(checkboxes[2]);
    fireEvent.click(checkboxes[3]);
    fireEvent.click(screen.getByRole('button', { name: 'mapping.previewButton' }));

    await waitFor(() => expect(api.previewSourceMapping).toHaveBeenCalledTimes(1));
    finishFirst({ entities: [], stats: { scannedRows: 1, resolvedEntities: 0, duplicateKeysSkipped: 0, nullIdentitySkipped: 0 }, identityEvidence: [], warnings: [] });
    await waitFor(() => expect(api.previewSourceMapping).toHaveBeenCalledTimes(2));
    expect(api.previewSourceMapping).toHaveBeenCalledWith('model-1', expect.objectContaining({ conceptId: 'concept-1', assetKind: 'document' }));
    fireEvent.click(screen.getByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(api.createBulkDocumentSourceMappings).toHaveBeenCalledWith('model-1', expect.objectContaining({ identityFields: ['contract_number', 'amendment_number'], documents: expect.arrayContaining([
      { workspaceId: 'workspace-1', documentId: 'document-1' },
      { workspaceId: 'workspace-1', documentId: 'document-2' },
    ]) })));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['semantic-models', 'data-preview', 'model-1'] });
  });
});
