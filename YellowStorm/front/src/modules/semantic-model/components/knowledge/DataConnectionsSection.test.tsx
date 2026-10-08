import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { semanticModelApi } from '../../api';
import { DataConnectionsSection } from './DataConnectionsSection';

const workspaceApi = vi.hoisted(() => ({ getWorkspaces: vi.fn(), getDocuments: vi.fn() }));
vi.mock('@/modules/workspace/api', () => workspaceApi);
vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));

const connection = { id: 'c-1', kind: 'mail_archive' as const, name: 'Legal mailbox', workspaceId: 'ws', documentId: 'zip', indexInWorkspace: false,
  limits: {}, ceilings: { archiveTimeoutSeconds: 900, parserMemoryMb: 512 }, available: true, createdAt: '2026-10-07T00:00:00.000Z' };

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe('DataConnectionsSection', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(semanticModelApi, 'listDataConnections').mockResolvedValue([connection]);
    vi.spyOn(semanticModelApi, 'profileSourceAsset').mockResolvedValue({ sheets: [
      { name: 'messages', rowCount: 120, fieldCount: 14 }, { name: 'participants', rowCount: 1, fieldCount: 5 }, { name: 'attachments', rowCount: 30, fieldCount: 9 },
    ] });
  });

  it('opens a mail archive on its three tables, each usable and draggable as a source with its table named', async () => {
    const onUse = vi.fn(), onDragStart = vi.fn();
    render(wrap(<DataConnectionsSection modelId='m' canEdit onUse={onUse} onDragStart={onDragStart} onDragEnd={vi.fn()} onShowWorkspaces={vi.fn()} />));
    fireEvent.click(await screen.findByRole('button', { name: 'dataSources.expand' }));
    expect(await screen.findByText('dataSources.table.messages')).toBeInTheDocument();
    expect(screen.getByText('dataSources.table.participants')).toBeInTheDocument();
    expect(screen.getByText('dataSources.table.attachments')).toBeInTheDocument();
    expect(semanticModelApi.profileSourceAsset).toHaveBeenCalledWith('m', 'zip', 'ws');

    fireEvent.click(screen.getAllByRole('button', { name: 'dataSources.useTable' })[1]);
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ kind: 'document', workspaceId: 'ws', documentId: 'zip', sheetName: 'participants', structured: true, mappable: true }));
    fireEvent.dragStart(screen.getAllByRole('group', { name: 'dataSources.dragTable' })[0]);
    expect(onDragStart.mock.calls[0][1]).toMatchObject({ sheetName: 'messages' });
  });

  it('offers to read an archive not read yet', async () => {
    vi.mocked(semanticModelApi.profileSourceAsset).mockResolvedValue({ sheets: [] });
    const analyze = vi.spyOn(semanticModelApi, 'analyzeSourceAsset').mockResolvedValue({ sheets: [{ name: 'messages', rowCount: 2, fieldCount: 14 }] });
    render(wrap(<DataConnectionsSection modelId='m' canEdit onDragStart={vi.fn()} onDragEnd={vi.fn()} onShowWorkspaces={vi.fn()} />));
    fireEvent.click(await screen.findByRole('button', { name: 'dataSources.expand' }));
    fireEvent.click(await screen.findByRole('button', { name: /dataSources.readNow/ }));
    await waitFor(() => expect(analyze).toHaveBeenCalledWith('m', 'zip', 'ws'));
    expect(await screen.findByText(/dataSources.rows_other/)).toBeInTheDocument();
  });

  it('lets an editor choose to also index an archive in its workspace, off by default', async () => {
    const update = vi.spyOn(semanticModelApi, 'updateDataConnection').mockResolvedValue({ ...connection, indexInWorkspace: true });
    render(wrap(<DataConnectionsSection modelId='m' canEdit onDragStart={vi.fn()} onDragEnd={vi.fn()} onShowWorkspaces={vi.fn()} />));
    fireEvent.click(await screen.findByRole('button', { name: 'dataSources.settingsOpen' }));
    const box = await screen.findByRole('checkbox', { name: 'dataSources.indexToggle' });
    expect(box).not.toBeChecked();
    fireEvent.click(box);
    await waitFor(() => expect(update).toHaveBeenCalledWith('m', 'c-1', { indexInWorkspace: true }));
  });

  it("sets an archive's reading limits, read time and memory no higher than the admin allows", async () => {
    const update = vi.spyOn(semanticModelApi, 'updateDataConnection').mockResolvedValue(connection);
    render(wrap(<DataConnectionsSection modelId='m' canEdit onDragStart={vi.fn()} onDragEnd={vi.fn()} onShowWorkspaces={vi.fn()} />));
    fireEvent.click(await screen.findByRole('button', { name: 'dataSources.settingsOpen' }));
    expect(screen.getByLabelText('settings.runLimits.maxArchiveEmails')).toHaveAttribute('placeholder', '50000');
    const memory = screen.getByLabelText('settings.runLimits.parserMemoryMb');
    expect(memory).toHaveAttribute('placeholder', '512');
    fireEvent.change(memory, { target: { value: '1024' } });
    expect(screen.getByRole('button', { name: 'settings.save' })).toBeDisabled();
    fireEvent.change(memory, { target: { value: '300' } });
    fireEvent.change(screen.getByLabelText('settings.runLimits.maxArchiveEmails'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'settings.save' }));
    await waitFor(() => expect(update).toHaveBeenCalledWith('m', 'c-1', { limits: { parserMemoryMb: 300, maxArchiveEmails: 200 } }));
  });

  it('keeps a connection whose file is gone closed and says why; viewers cannot connect or remove', async () => {
    vi.mocked(semanticModelApi.listDataConnections).mockResolvedValue([{ ...connection, available: false }]);
    render(wrap(<DataConnectionsSection modelId='m' canEdit={false} onDragStart={vi.fn()} onDragEnd={vi.fn()} onShowWorkspaces={vi.fn()} />));
    expect(await screen.findByText('dataSources.unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'dataSources.expand' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'dataSources.connect' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'dataSources.remove' })).not.toBeInTheDocument();
  });

  it('connects a mail archive picked among the .zip and .eml files of a workspace', async () => {
    vi.mocked(semanticModelApi.listDataConnections).mockResolvedValue([]);
    const create = vi.spyOn(semanticModelApi, 'createDataConnection').mockResolvedValue(connection);
    workspaceApi.getWorkspaces.mockResolvedValue({ workspaces: [{ id: 'ws', name: 'Legal' }], pagination: { page: 1, totalPages: 1 } });
    workspaceApi.getDocuments.mockImplementation(async (_ws: string, params: { search: string }) => ({ documents: params.search === '.zip'
      ? [{ id: 'zip', originalName: 'mails.zip', mimeType: 'application/zip', isFolder: false }, { id: 'pdf', originalName: 'a.zip.pdf', mimeType: 'application/pdf', isFolder: false }]
      : [], pagination: { page: 1, totalPages: 1 } }));
    render(wrap(<DataConnectionsSection modelId='m' canEdit onDragStart={vi.fn()} onDragEnd={vi.fn()} onShowWorkspaces={vi.fn()} />));
    expect(await screen.findByText('dataSources.empty')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'dataSources.connect' }));
    expect(screen.getByRole('button', { name: /dataSources.dialog.postgres.title/ })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /dataSources.dialog.mail.title/ }));
    await waitFor(() => expect(workspaceApi.getWorkspaces).toHaveBeenCalled());
    // The workspace picker is a Radix select; pick through its trigger and option.
    fireEvent.click(screen.getByRole('combobox', { name: 'dataSources.dialog.workspaceLabel' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Legal' }));
    fireEvent.click(await screen.findByRole('radio', { name: /mails\.zip/ }));
    expect(screen.queryByText('a.zip.pdf')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'dataSources.dialog.submit' }));
    await waitFor(() => expect(create).toHaveBeenCalledWith('m', { kind: 'mail_archive', workspaceId: 'ws', documentId: 'zip', name: undefined, indexInWorkspace: false }));
  });
});
