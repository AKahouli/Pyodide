import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showSuccess } from '@/lib/notifications';
import { useSemanticModelEditorStore } from '../store';
import type { SemanticGraph } from '../types';
import { useAssistantSync } from './use-assistant-sync';

const api = vi.hoisted(() => ({ assistantChanges: vi.fn(), graph: vi.fn(), undoAssistantChange: vi.fn(), redoAssistantChange: vi.fn() }));
vi.mock('../api', () => ({ semanticModelApi: api }));
vi.mock('@/lib/notifications', () => ({ showSuccess: vi.fn(), showError: vi.fn() }));

const node = (id: string) => ({ id, key: id, label: id, description: '', category: 'business_object' as const, recordPolicy: 'optional' as const, systemKey: null, aliases: [], attributes: [], position: { x: 0, y: 0 } });
const local: SemanticGraph = { modelId: 'm', versionId: 'v', revision: 3, nodes: [node('customer')], relations: [], records: [], recordRelations: [] };
const server: SemanticGraph = { ...local, revision: 4, nodes: [node('customer'), node('invoice')] };
const change = { id: 'c-1', message: 'added concept invoice', agentId: 'a', createdAt: '2026-09-27T10:00:01Z', undoneAt: null };

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('useAssistantSync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSemanticModelEditorStore.getState().hydrate(local);
  });

  it('reloads the model when an assistant changes it, keeps unsaved edits, and offers Undo', async () => {
    api.assistantChanges
      .mockResolvedValueOnce({ graphRevision: 3, now: '2026-09-27T10:00:00Z', changes: [] })
      .mockResolvedValue({ graphRevision: 4, now: '2026-09-27T10:00:05Z', changes: [change] });
    api.graph.mockResolvedValue(server);
    api.undoAssistantChange.mockResolvedValue({ undone: true });
    // An edit made on the canvas that is not saved yet.
    const contract = node('contract');
    useSemanticModelEditorStore.getState().commit({ type: 'node_type.create', entity: contract }, (graph) => ({ ...graph, nodes: [...graph.nodes, contract] }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useAssistantSync('m'), { wrapper: wrapper(client) });
    await waitFor(() => expect(api.assistantChanges).toHaveBeenCalledTimes(1));
    await act(async () => { await client.refetchQueries({ queryKey: ['semantic-models', 'assistant-changes', 'm'] }); });

    await waitFor(() => expect(api.assistantChanges).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(useSemanticModelEditorStore.getState().graph?.revision).toBe(4));
    expect(useSemanticModelEditorStore.getState().graph?.nodes.map((item) => item.id)).toEqual(['customer', 'invoice', 'contract']);
    expect(api.assistantChanges).toHaveBeenLastCalledWith('m', '2026-09-27T10:00:00Z');
    expect(showSuccess).toHaveBeenCalledWith('designer.assistantChange.done: added concept invoice', expect.objectContaining({ action: expect.anything() }));

    // Undo in the editor reverses the assistant change on the server.
    await act(async () => { await useSemanticModelEditorStore.getState().undo(); });
    expect(api.undoAssistantChange).toHaveBeenCalledWith('m', 'c-1');
  });

  it('does not announce changes made before the editor opened', async () => {
    api.assistantChanges.mockResolvedValue({ graphRevision: 3, now: '2026-09-27T10:00:00Z', changes: [change] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useAssistantSync('m'), { wrapper: wrapper(client) });
    await waitFor(() => expect(api.assistantChanges).toHaveBeenCalled());
    await act(async () => { await client.refetchQueries({ queryKey: ['semantic-models', 'assistant-changes', 'm'] }); });
    expect(showSuccess).not.toHaveBeenCalled();
    expect(api.graph).not.toHaveBeenCalled();
  });
});
