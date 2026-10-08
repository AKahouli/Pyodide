import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSemanticModelEditorStore } from '../../store';
import type { SemanticGraph, SemanticRelationType } from '../../types';
import { RelationMatchingPanel } from './RelationMatchingPanel';

const rules = vi.hoisted(() => ({ data: [] as Array<Record<string, unknown>> }));
const saveRelationResolutionRule = vi.hoisted(() => vi.fn(async () => ({ id: 'rule-1', revision: 2 })));
vi.mock('../../query/hooks', () => ({ useRelationResolutionRules: () => ({ data: rules.data, isLoading: false }) }));
vi.mock('../../api', () => ({ semanticModelApi: { saveRelationResolutionRule, previewRelationResolutionRule: vi.fn() } }));
vi.mock('../common/Select', () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) =>
    <div data-value={value}>{children}<input aria-label='select' value={value} onChange={(event) => onValueChange(event.target.value)} /></div>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
}));

const relation = { id: 'documente', key: 'documente', label: 'documente', sourceNodeTypeId: 'pj', targetNodeTypeId: 'fait' } as SemanticRelationType;
const graph = {
  modelId: 'model', versionId: 'v', revision: 1, relations: [relation], records: [], recordRelations: [],
  nodes: [
    { id: 'pj', key: 'pj', label: 'Pièce jointe', attributes: [{ key: 'cle', label: 'Clé', type: 'text' }, { key: 'nom', label: 'Nom', type: 'text' }] },
    { id: 'fait', key: 'fait', label: 'Fait', attributes: [{ key: 'cle', label: 'Clé', type: 'text' }, { key: 'message', label: 'Message', type: 'text' }] },
  ],
} as unknown as SemanticGraph;

const renderPanel = () => render(<QueryClientProvider client={new QueryClient()}><RelationMatchingPanel modelId='model' relation={relation} /></QueryClientProvider>);

describe('RelationMatchingPanel', () => {
  beforeEach(() => { saveRelationResolutionRule.mockClear(); useSemanticModelEditorStore.getState().hydrate(graph); });

  it('saves a change to an existing rule on its own, without a Save button', async () => {
    rules.data = [{ id: 'rule-1', relationId: 'documente', sourceAttribute: 'cle', targetAttribute: 'cle', strategy: 'exact', ambiguityPolicy: 'review' }];
    renderPanel();
    expect(screen.queryByRole('button', { name: 'relationMatching.save' })).not.toBeInTheDocument();
    // Opening the panel saves nothing.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(saveRelationResolutionRule).not.toHaveBeenCalled();
    fireEvent.change(screen.getAllByLabelText('select')[1], { target: { value: 'message' } });
    await waitFor(() => expect(saveRelationResolutionRule).toHaveBeenCalledWith('model', expect.objectContaining({ sourceAttribute: 'cle', targetAttribute: 'message' })));
    expect(saveRelationResolutionRule).toHaveBeenCalledTimes(1);
  });

  it('asks once to save a link that has no rule yet, then saves changes on their own', async () => {
    rules.data = [];
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'relationMatching.save' }));
    await waitFor(() => expect(saveRelationResolutionRule).toHaveBeenCalledWith('model', expect.objectContaining({ sourceAttribute: 'cle', targetAttribute: 'cle' })));
  });
});
