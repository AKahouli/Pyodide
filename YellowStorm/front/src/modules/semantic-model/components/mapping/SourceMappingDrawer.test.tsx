import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSemanticModelEditorStore } from '../../store';
import type { ConceptSourceMapping, SemanticGraph } from '../../types';
import { SourceMappingDrawer } from './SourceMappingDrawer';

const api = vi.hoisted(() => ({
  listSourceMappings: vi.fn(), profileSourceAsset: vi.fn(), createSourceMapping: vi.fn(), previewSourceMapping: vi.fn(),
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

  it('adopts the revision the mapping command produced so the next autosave does not conflict', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(<QueryClientProvider client={client}><SourceMappingDrawer modelId='model-1' target={{ workspaceId: mapping.workspaceId, documentId: mapping.documentId, documentName: mapping.documentName!, assetKind: mapping.assetKind, conceptId: mapping.conceptId, mapping }} onClose={vi.fn()} /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'mapping.save' }));
    await waitFor(() => expect(useSemanticModelEditorStore.getState().graph?.revision).toBe(2));
  });
});
