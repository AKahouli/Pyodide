import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Checkbox } from '@/components/ui/checkbox';
import en from '../locales/en.json';
import { WorkspaceFileBrowser } from './WorkspaceFileBrowser';
import type { WorkspaceFile, WorkspaceFolder } from '../types';

const mocks = vi.hoisted(() => ({ canWrite: true, refresh: vi.fn(async () => undefined), assign: vi.fn(async () => undefined), move: vi.fn(async () => undefined), removeFolder: vi.fn(async () => undefined), removeFile: vi.fn(async () => undefined), index: vi.fn(async () => undefined), success: vi.fn(), warning: vi.fn() }));
vi.mock('../store', () => ({ useCanWriteWorkspace: () => mocks.canWrite, useWorkspaceStore: Object.assign((selector: (state: unknown) => unknown) => selector({ refreshPageData: mocks.refresh }), { getState: () => ({ selectedWorkspaceId: 'ws' }) }) }));
vi.mock('../page-api', () => ({ assignFileToFolder: mocks.assign, moveFolder: mocks.move, deleteFolder: mocks.removeFolder }));
vi.mock('../api', () => ({ deleteDocument: mocks.removeFile, reindexDocument: mocks.index }));
vi.mock('@/lib/notifications', () => ({ showSuccess: mocks.success, showWarning: mocks.warning }));
vi.mock('../hooks/useDeepSearchIndexation', () => ({ readDeepSearchIndexationValue: () => false }));
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)), (en as Record<string, unknown>)[key] as string ?? key) }) }));

const folder = (id: string, name: string, parentId: string | null = null): WorkspaceFolder => ({ id, name, parentId, workspaceId: 'ws', description: '', createdBy: 'u', childCount: 0, fileCount: 0, createdAt: '', updatedAt: '' });
const file = (id: number, indexingStatus: WorkspaceFile['indexingStatus'] = 'ready'): WorkspaceFile => ({ id: `file-${id}`, name: `Invoice-${String(id).padStart(3, '0')}.pdf`, workspaceId: 'ws', folderId: null, indexingStatus, mimeType: 'application/pdf', size: 100, uploadedAt: null, assignmentSource: null });

function setup(files = Array.from({ length: 30 }, (_, i) => file(i)), folders = [folder('finance', 'Finance'), folder('reports', 'Reports', 'finance')]) {
  const props = { workspaceId: 'ws', folders, files, artifacts: [], currentFolderId: null, search: '', onSearch: vi.fn(), onNavigate: vi.fn(), onEditFolder: vi.fn(), renderFile: (f: WorkspaceFile, selection: { selected: boolean; onToggle: (range: boolean) => void; disabled: boolean }) => <tr key={f.id}><td>{mocks.canWrite && <Checkbox checked={selection.selected} aria-label={`Select ${f.name}`} onCheckedChange={() => selection.onToggle(false)} disabled={selection.disabled} />}</td><td>{f.name}</td></tr> };
  const result = render(<WorkspaceFileBrowser {...props} />);
  return { ...result, props };
}

describe('WorkspaceFileBrowser', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.canWrite = true; });


  it('keeps selection across pagination, distinguishes page/all results, and clears it on scope changes', () => {
    setup();
    fireEvent.click(screen.getByRole('button', { name: /All files/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select items on this page' }));
    expect(screen.getByText('25 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(screen.getByText('25 selected')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Select all 30 matching items' }));
    expect(screen.getByText('30 selected')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter by indexing status' }), { target: { value: 'failed' } });
    expect(screen.queryByLabelText('Batch actions')).not.toBeInTheDocument();
    expect(screen.getByText(/No matching items/)).toBeInTheDocument();
  });

  it('moves selected files through classifier assignment and retains only failures for retry', async () => {
    setup([file(0), file(1)]);
    mocks.assign.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Invoice-000.pdf' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Invoice-001.pdf' }));
    fireEvent.click(within(screen.getByLabelText('Batch actions')).getByRole('button', { name: 'Move to…' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Destination folder' }), { target: { value: 'finance' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move here' }));
    await waitFor(() => expect(mocks.assign).toHaveBeenCalledTimes(2));
    expect(mocks.assign).toHaveBeenCalledWith('ws', 'file-0', 'finance');
    await waitFor(() => expect(screen.getByText('1 selected')).toBeInTheDocument());
    expect(screen.getByRole('checkbox', { name: 'Select Invoice-000.pdf' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Select Invoice-001.pdf' })).not.toBeChecked();
    expect(mocks.warning).toHaveBeenCalledWith('1 succeeded · 1 failed');
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
  });

  it('blocks moving a folder into itself or a descendant', () => {
    setup([]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Finance' }));
    fireEvent.click(within(screen.getByLabelText('Batch actions')).getByRole('button', { name: 'Move to…' }));
    const destination = screen.getByRole('combobox', { name: 'Destination folder' });
    expect(within(destination).queryByRole('option', { name: /Finance/ })).not.toBeInTheDocument();
    expect(within(destination).queryByRole('option', { name: /Reports/ })).not.toBeInTheDocument();
  });

  it('requires permanent-delete confirmation and explains that folder deletion preserves contained files', async () => {
    setup([file(0)]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Finance' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Invoice-000.pdf' }));
    fireEvent.click(within(screen.getByLabelText('Batch actions')).getByRole('button', { name: 'Delete' }));
    expect(mocks.removeFile).not.toHaveBeenCalled();
    expect(screen.getByText(/Files inside them are kept/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Delete permanently' }));
    await waitFor(() => expect(mocks.removeFile).toHaveBeenCalledWith('ws', 'file-0', true));
    expect(mocks.removeFolder).toHaveBeenCalledWith('finance');
  });

  it('indexes eligible files and skips files already processing', async () => {
    setup([file(0, 'failed'), file(1, 'processing')], []);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select items on this page' }));
    fireEvent.click(within(screen.getByLabelText('Batch actions')).getByRole('button', { name: 'Index / reindex' }));
    expect(screen.getByText(/Queue 1 eligible files/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Index / reindex' }));
    await waitFor(() => expect(mocks.index).toHaveBeenCalledTimes(1));
    expect(mocks.index).toHaveBeenCalledWith('ws', 'file-0', false);
  });

  it('keeps folder navigation available without exposing mutation controls to readers', () => {
    mocks.canWrite = false;
    const { props } = setup();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Finance' })[0]);
    expect(props.onNavigate).toHaveBeenCalledWith('finance');
    expect(screen.queryByLabelText('Batch actions')).not.toBeInTheDocument();
  });
});
