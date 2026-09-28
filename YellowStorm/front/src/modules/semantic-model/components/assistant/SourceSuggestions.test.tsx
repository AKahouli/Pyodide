import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SourceSuggestionsPage } from '../../types';
import { SourceSuggestionsCard, suggestionRoute, takeChosenSource } from './SourceSuggestions';

const api = vi.hoisted(() => ({ sourceSuggestions: vi.fn(), setSourceSuggestionStatus: vi.fn() }));
vi.mock('../../api', () => ({ semanticModelApi: api }));
// The chooser has its own tests: here it only needs to hand back a choice.
vi.mock('./SourceChooser', () => ({
  SourceChooserDialog: ({ open, conceptLabel, onChoose }: { open: boolean; conceptLabel: string; onChoose: (option: unknown) => void }) => open
    ? <button type='button' onClick={() => onChoose({ workspaceId: 'ws-3', workspaceName: 'HR', kind: 'workspace', folderIds: [], documentIds: [], folders: [], documents: [], fileCount: 0, stillIndexing: 0, reason: '' })}>choose for {conceptLabel}</button>
    : null,
}));

const page: SourceSuggestionsPage = {
  model: { id: 'model-1', name: 'Billing & Contracts' },
  suggestions: [
    {
      conceptId: 'c-1', conceptKey: 'contract', conceptLabel: 'Contract', note: '', status: 'pending', updatedAt: '',
      options: [
        { workspaceId: 'ws-1', workspaceName: 'Legal', kind: 'documents', folderIds: ['f-1'], documentIds: [], folders: ['Signed 2024'], documents: [], fileCount: 1240, stillIndexing: 3, reason: 'signed contracts' },
        { workspaceId: 'ws-2', workspaceName: 'Sales', kind: 'spreadsheet', folderIds: [], documentIds: ['d-1'], folders: [], documents: ['contracts.xlsx'], sheetName: 'List', fileCount: 1, stillIndexing: 0, reason: '' },
      ],
    },
    { conceptId: 'c-2', conceptKey: 'customer', conceptLabel: 'Customer', note: '', status: 'connected', updatedAt: '', options: [] },
  ],
};

function renderCard(onNavigate = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SourceSuggestionsCard modelId='model-1' onNavigate={onNavigate} /></QueryClientProvider>);
  return onNavigate;
}

describe('SourceSuggestionsCard', () => {
  beforeEach(() => {
    api.sourceSuggestions.mockResolvedValue(page);
    api.setSourceSuggestionStatus.mockResolvedValue({ ...page, suggestions: [{ ...page.suggestions[0], status: 'skipped' }, page.suggestions[1]] });
  });

  it('shows each suggestion by name with how many files it covers, and warns about large ones', async () => {
    renderCard();
    expect(await screen.findByText('Contract')).toBeInTheDocument();
    expect(screen.getByText('Legal › Signed 2024')).toBeInTheDocument();
    expect(screen.getByText('assistantSources.files · assistantSources.stillIndexing')).toBeInTheDocument();
    expect(screen.getByText('assistantSources.large')).toBeInTheDocument();
    expect(screen.getByText('assistantSources.fileSheetIn')).toBeInTheDocument();
    expect(screen.getByText('assistantSources.connected')).toBeInTheDocument();
    expect(screen.queryByText(/model-1|ws-1|f-1/)).not.toBeInTheDocument();
  });

  it('opens the designer to check a suggestion, files chosen from the list, or just to continue', async () => {
    const onNavigate = renderCard();
    fireEvent.click((await screen.findAllByText('assistantSources.use'))[1]);
    expect(onNavigate).toHaveBeenLastCalledWith('/semantic-models/model-1?suggestion=contract&option=1');
    fireEvent.click(screen.getByText('assistantSources.browse'));
    fireEvent.click(screen.getByText('choose for Contract'));
    expect(onNavigate).toHaveBeenLastCalledWith('/semantic-models/model-1?suggestion=contract&choice=1');
    expect(takeChosenSource('model-1', 'contract')).toMatchObject({ workspaceName: 'HR', kind: 'workspace' });
    expect(takeChosenSource('model-1', 'contract')).toBeUndefined();
    fireEvent.click(screen.getByText('assistantSources.continue'));
    expect(onNavigate).toHaveBeenLastCalledWith('/semantic-models/model-1');
  });

  it('skips a concept without connecting anything', async () => {
    renderCard();
    fireEvent.click(await screen.findByText('assistantSources.skip'));
    await waitFor(() => expect(api.setSourceSuggestionStatus).toHaveBeenCalledWith('model-1', 'contract', 'skipped'));
    expect(await screen.findByText('assistantSources.skipped')).toBeInTheDocument();
  });

  it('links the whole list or one choice', () => {
    expect(suggestionRoute('model 1')).toBe('/semantic-models/model%201?sources=1');
    expect(suggestionRoute('m', { conceptKey: 'invoice line', option: 2 })).toBe('/semantic-models/m?suggestion=invoice+line&option=2');
  });
});
