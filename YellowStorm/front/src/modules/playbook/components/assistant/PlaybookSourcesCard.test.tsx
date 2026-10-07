import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlaybookSourceQuestions } from '../../assistant-sources-api';
import { PlaybookSourcesCard } from './PlaybookSourcesCard';

const api = vi.hoisted(() => ({ getPlaybookSourceQuestions: vi.fn(), choosePlaybookSources: vi.fn(), searchPlaybookSourceFiles: vi.fn() }));
vi.mock('../../assistant-sources-api', () => api);
// The chooser has its own tests: here it only hands back a choice, and shows which mode it was opened in.
vi.mock('@/modules/semantic-model/components/assistant/SourceChooser', () => ({
  SourceChooserDialog: ({ open, mode, conceptLabel, initialSearch, onChoose }: { open: boolean; mode: string; conceptLabel: string; initialSearch?: string; onChoose: (option: unknown) => void }) => open
    ? <button type='button' onClick={() => onChoose(mode === 'workspace'
      ? { workspaceId: 'ws-2', workspaceName: 'Shortlists', kind: 'workspace', folderIds: [], documentIds: [], folders: [], documents: [], fileCount: 0, stillIndexing: 0, reason: '' }
      : { workspaceId: 'ws-1', workspaceName: 'Recruiting', kind: 'documents', folderIds: [], documentIds: ['f-1', 'f-2'], folders: [], documents: ['CV Ines.pdf', 'CV Salim.pdf'], fileCount: 0, stillIndexing: 0, reason: '' })}>
      choose {mode} for {conceptLabel}{initialSearch ? ` from ${initialSearch}` : ''}
    </button>
    : null,
}));

const waiting: PlaybookSourceQuestions = {
  playbookName: 'CV screening',
  questions: [
    { id: 'source', question: 'Which CVs?', reason: 'The screening input', required: true, selector: 'workspace_or_document', choices: ['Workspace “CV”', 'SharePoint'], choice: null },
    { id: 'destination', question: 'Where to save the shortlist?', reason: '', required: true, selector: 'destination_workspace', choices: [], choice: null },
  ],
};

function renderCard(onSend?: (text: string) => boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><PlaybookSourcesCard continuationId='continuation-1' onSend={onSend} /></QueryClientProvider>);
}

describe('PlaybookSourcesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getPlaybookSourceQuestions.mockResolvedValue(waiting);
  });

  it('keeps the files chosen from the searchable list, and a workspace for a destination', async () => {
    api.choosePlaybookSources
      .mockResolvedValueOnce({ ...waiting, questions: [{ ...waiting.questions[0], choice: { skipped: false, resources: [{ kind: 'document', name: 'CV Ines.pdf', workspaceName: 'Recruiting' }, { kind: 'document', name: 'CV Salim.pdf', workspaceName: 'Recruiting' }] } }, waiting.questions[1]] });
    renderCard(vi.fn(() => true));
    expect(await screen.findByText('Which CVs?')).toBeInTheDocument();
    fireEvent.click(screen.getAllByText('playbookSources.chooseFiles')[0]);
    fireEvent.click(screen.getByText('choose files for Which CVs?'));
    await waitFor(() => expect(api.choosePlaybookSources).toHaveBeenCalledWith('continuation-1', 'source', {
      resources: [{ kind: 'document', id: 'f-1' }, { kind: 'document', id: 'f-2' }],
    }));
    expect(await screen.findByText('playbookSources.fileChoice, playbookSources.fileChoice')).toBeInTheDocument();

    fireEvent.click(screen.getByText('playbookSources.chooseWorkspace'));
    fireEvent.click(screen.getByText('choose workspace for Where to save the shortlist?'));
    await waitFor(() => expect(api.choosePlaybookSources).toHaveBeenLastCalledWith('continuation-1', 'destination', {
      resources: [{ kind: 'workspace', id: 'ws-2' }],
    }));
  });

  it('continues only once every required question is chosen or skipped, and says so by name', async () => {
    const onSend = vi.fn(() => true);
    api.choosePlaybookSources.mockResolvedValueOnce({
      ...waiting,
      questions: [
        { ...waiting.questions[0], choice: { skipped: false, resources: [{ kind: 'workspace', name: 'Recruiting', workspaceName: 'Recruiting' }] } },
        { ...waiting.questions[1], choice: { skipped: true } },
      ],
    });
    renderCard(onSend);
    await screen.findByText('Which CVs?');
    expect(screen.getByText('playbookSources.continue')).toBeDisabled();
    fireEvent.click(screen.getAllByText('playbookSources.skip')[1]);
    await waitFor(() => expect(api.choosePlaybookSources).toHaveBeenCalledWith('continuation-1', 'destination', { skip: true }));
    await waitFor(() => expect(screen.getByText('playbookSources.continue')).toBeEnabled());
    fireEvent.click(screen.getByText('playbookSources.continue'));
    await waitFor(() => expect(onSend).toHaveBeenCalledWith('playbookSources.continueMessage'));
    expect(await screen.findByText('playbookSources.sent')).toBeDisabled();
  });

  it('keeps an answer that is not a workspace, and opens the list at the workspace an answer names', async () => {
    api.choosePlaybookSources.mockResolvedValueOnce({ ...waiting, questions: [{ ...waiting.questions[0], choice: { skipped: false, option: 'SharePoint', resources: [] } }, waiting.questions[1]] });
    renderCard();
    fireEvent.click(await screen.findByText('SharePoint'));
    await waitFor(() => expect(api.choosePlaybookSources).toHaveBeenCalledWith('continuation-1', 'source', { choice: 'SharePoint' }));
    await waitFor(() => expect(screen.getByText('SharePoint', { selector: 'button' })).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByText('Workspace “CV”'));
    expect(screen.getByText('choose files for Which CVs? from CV')).toBeInTheDocument();
  });

  it('says the questions were answered once Yellowmind continued', async () => {
    api.getPlaybookSourceQuestions.mockRejectedValue({ code: 'ERR_1004', message: 'gone', statusCode: 404 });
    renderCard();
    expect(await screen.findByText('playbookSources.answered')).toBeInTheDocument();
  });
});
