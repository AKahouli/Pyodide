import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SourceChooserDialog } from './SourceChooser';

const api = vi.hoisted(() => ({ searchSourceFiles: vi.fn() }));
const workspaceApi = vi.hoisted(() => ({ getWorkspaces: vi.fn(), getSharedWorkspaces: vi.fn(), getDocuments: vi.fn(), getFolderContents: vi.fn() }));
vi.mock('../../api', () => ({ semanticModelApi: api }));
vi.mock('@/modules/workspace/api', () => workspaceApi);

const pdf = 'application/pdf';
const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function renderChooser() {
  const onChoose = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><SourceChooserDialog open modelId='model-1' conceptLabel='Candidate' onClose={vi.fn()} onChoose={onChoose} /></QueryClientProvider>);
  return onChoose;
}

describe('SourceChooserDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workspaceApi.getWorkspaces.mockResolvedValue({ workspaces: [{ id: 'ws-1', name: 'Recruiting', documentCount: 12 }], pagination: { totalPages: 1 } });
    workspaceApi.getSharedWorkspaces.mockResolvedValue({ workspaces: [{ id: 'ws-2', name: 'HR shared', documentCount: 3 }] });
    workspaceApi.getDocuments.mockResolvedValue({ documents: [], pagination: { totalPages: 1 } });
    api.searchSourceFiles.mockResolvedValue({ page: 1, totalPages: 1, files: [
      { id: 'f-1', name: 'CV Ines.pdf', mimeType: pdf, kind: 'document', workspaceId: 'ws-1', workspaceName: 'Recruiting', folderName: '2024' },
      { id: 'f-2', name: 'CV Salim.pdf', mimeType: pdf, kind: 'document', workspaceId: 'ws-1', workspaceName: 'Recruiting', folderName: null },
      { id: 'f-3', name: 'cv_export.xlsx', mimeType: xlsx, kind: 'spreadsheet', workspaceId: 'ws-2', workspaceName: 'HR shared', folderName: null },
    ] });
  });

  it('lists every workspace, own and shared, and uses a whole one', async () => {
    const onChoose = renderChooser();
    expect(await screen.findByText('Recruiting')).toBeInTheDocument();
    expect(screen.getByText('HR shared')).toBeInTheDocument();
    expect(screen.getByText('assistantSources.chooser.use')).toBeDisabled();
    fireEvent.click(screen.getByText('Recruiting').closest('button')!);
    fireEvent.click(screen.getByText('assistantSources.chooser.use'));
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-1', workspaceName: 'Recruiting', kind: 'workspace' }));
  });

  it('finds files by name across workspaces and uses the ones ticked', async () => {
    const onChoose = renderChooser();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'cv' } });
    expect(await screen.findByText('CV Ines.pdf')).toBeInTheDocument();
    await waitFor(() => expect(api.searchSourceFiles).toHaveBeenCalledWith('model-1', 'cv'));
    fireEvent.click(screen.getByText('CV Ines.pdf'));
    fireEvent.click(screen.getByText('CV Salim.pdf'));
    fireEvent.click(screen.getByText('assistantSources.chooser.use'));
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'ws-1', kind: 'documents', documentIds: ['f-1', 'f-2'], documents: ['CV Ines.pdf', 'CV Salim.pdf'],
    }));
  });

  it('picks any files, spreadsheets included, with the search it is given', async () => {
    const onChoose = vi.fn();
    const searchFiles = vi.fn().mockResolvedValue({ files: [
      { id: 'f-3', name: 'cv_export.xlsx', mimeType: xlsx, kind: 'document', workspaceId: 'ws-2', workspaceName: 'HR shared', folderName: null },
      { id: 'f-4', name: 'grid.xlsx', mimeType: xlsx, kind: 'document', workspaceId: 'ws-2', workspaceName: 'HR shared', folderName: null },
    ] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><SourceChooserDialog open mode='files' searchFiles={searchFiles} conceptLabel='Which CVs?' title='Which CVs?' useLabel='Use for the playbook' onClose={vi.fn()} onChoose={onChoose} /></QueryClientProvider>);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'xl' } });
    fireEvent.click(await screen.findByText('cv_export.xlsx'));
    fireEvent.click(screen.getByText('grid.xlsx'));
    fireEvent.click(screen.getByText('Use for the playbook'));
    expect(searchFiles).toHaveBeenCalledWith('xl');
    expect(api.searchSourceFiles).not.toHaveBeenCalled();
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-2', kind: 'documents', documentIds: ['f-3', 'f-4'] }));
  });

  it('chooses one workspace only, without files', async () => {
    const onChoose = vi.fn();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><SourceChooserDialog open mode='workspace' conceptLabel='Where?' onClose={vi.fn()} onChoose={onChoose} /></QueryClientProvider>);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'cv' } });
    fireEvent.click((await screen.findByText('HR shared')).closest('button')!);
    expect(screen.queryByText('assistantSources.chooser.files')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('knowledge.expandWorkspace')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('assistantSources.chooser.use'));
    expect(api.searchSourceFiles).not.toHaveBeenCalled();
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-2', kind: 'workspace' }));
  });

  it('uses one spreadsheet on its own, and says a pick in another workspace replaces the first one', async () => {
    const onChoose = renderChooser();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'cv' } });
    fireEvent.click(await screen.findByText('CV Ines.pdf'));
    expect(screen.queryByText('assistantSources.chooser.oneWorkspace')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('cv_export.xlsx'));
    expect(screen.getByText('assistantSources.chooser.oneWorkspace')).toBeInTheDocument();
    fireEvent.click(screen.getByText('assistantSources.chooser.use'));
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'ws-2', kind: 'spreadsheet', documentIds: ['f-3'], documents: ['cv_export.xlsx'], mimeType: xlsx }));
  });
});
