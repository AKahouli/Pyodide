import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSemanticModelEditorStore } from '../../store';
import { SuggestConceptsDialog } from './SuggestConceptsDialog';

const api = vi.hoisted(() => ({
  profileSourceAsset: vi.fn(),
  analyzeSourceAsset: vi.fn(),
  listSourceAssets: vi.fn(),
  workspaces: vi.fn(async () => [{ workspaceId: 'ws', role: 'origin', enabled: true }]),
  connectWorkspace: vi.fn(),
  get: vi.fn(),
  createSourceMapping: vi.fn(async () => ({ revision: 5 })),
  saveRelationResolutionRule: vi.fn(async () => ({ id: 'rule', revision: 6 })),
}));
vi.mock('../../api', () => ({ semanticModelApi: api }));
vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));

const field = (name: string, uniqueRatio = 1) => ({ name, type: 'text', sample: '', populatedRatio: 1, uniqueRatio });
const profiles: Record<string, unknown> = {
  '': { sheets: [{ name: 'Customers', rowCount: 2, fieldCount: 2 }, { name: 'Contracts', rowCount: 2, fieldCount: 2 }] },
  Customers: { sheets: [], fields: [field('Number'), field('Name')], sampleRows: [{ Number: 'C1', Name: 'Acme' }, { Number: 'C2', Name: 'Globex' }] },
  Contracts: { sheets: [], fields: [field('Contract id'), field('Customer number', 0.5)], sampleRows: [{ 'Contract id': 'K1', 'Customer number': 'C1' }, { 'Contract id': 'K2', 'Customer number': 'C1' }] },
};

describe('SuggestConceptsDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.profileSourceAsset.mockImplementation(async (_model: string, _doc: string, _ws: string, sheet?: string) => profiles[sheet ?? '']);
    useSemanticModelEditorStore.getState().hydrate({ modelId: 'model', versionId: 'v', revision: 1, nodes: [], relations: [], records: [], recordRelations: [] });
  });

  it('proposes concepts per sheet and creates them with mapping, key and link', async () => {
    // Stand in for the editor autosave: acknowledge whatever the dialog commits.
    const unsubscribe = useSemanticModelEditorStore.subscribe((state) => {
      if (state.pending.length && !state.saveInFlight) queueMicrotask(() => useSemanticModelEditorStore.getState().markSaved(2, state.pending.length));
    });
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <SuggestConceptsDialog modelId='model' open onOpenChange={vi.fn()} source={{ workspaceId: 'ws', documentId: 'doc', documentName: 'crm.xlsx', assetKind: 'excel_sheet' }} />
    </QueryClientProvider>);
    expect(await screen.findByDisplayValue('Customer')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Contract')).toBeInTheDocument();
    expect(screen.getByText('suggest.relationSentence')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'suggest.apply' }));
    await waitFor(() => expect(api.saveRelationResolutionRule).toHaveBeenCalled());
    unsubscribe();
    const graph = useSemanticModelEditorStore.getState().graph!;
    expect(graph.nodes.map((node) => node.label)).toEqual(['Customer', 'Contract']);
    expect(graph.relations[0]).toMatchObject({ sourceNodeTypeId: graph.nodes[1].id, targetNodeTypeId: graph.nodes[0].id, cardinality: 'many_to_one' });
    expect(api.createSourceMapping).toHaveBeenCalledWith('model', expect.objectContaining({
      conceptId: graph.nodes[0].id, sheetName: 'Customers', identityFields: ['number'],
      fieldMappings: [{ sourceField: 'Number', targetAttribute: 'number', mode: 'direct' }, { sourceField: 'Name', targetAttribute: 'name', mode: 'direct' }],
    }));
    expect(api.saveRelationResolutionRule).toHaveBeenCalledWith('model', expect.objectContaining({
      relationId: graph.relations[0].id, sourceAttribute: 'customer_number', targetAttribute: 'number',
    }));
    expect(graph.revision).toBe(6);
  });
});
