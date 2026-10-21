vi.mock('../api', () => ({}));
vi.mock('../page-api', () => ({}));
vi.mock('../artifact-api', () => ({}));
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceUploadActivity } from './WorkspaceUploadActivity';
import { useWorkspaceStore } from '../store';
vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));

describe('WorkspaceUploadActivity', () => {
  beforeEach(() => useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true));
  it('separates upload completion and indexing, preserves failures and only cancels pending items', () => {
    const cancelUpload = vi.fn();
    const retryPageUpload = vi.fn();
    const file = new File(['data'], 'report.pdf');
    useWorkspaceStore.setState({ selectedWorkspaceId: 'ws', cancelUpload, retryPageUpload, uploadQueue: [
      { id: 'pending', workspaceId: 'ws', file, progress: 0, status: 'pending' },
      { id: 'active', workspaceId: 'ws', file, progress: 45, status: 'uploading' },
      { id: 'failed', workspaceId: 'ws', file, progress: 100, status: 'failed', error: 'Storage offline' },
      { id: 'done', workspaceId: 'ws', file, progress: 100, status: 'completed' },
      { id: 'other', workspaceId: 'other', file: new File(['x'], 'hidden.pdf'), progress: 0, status: 'pending' },
    ] });
    render(<WorkspaceUploadActivity />);
    expect(screen.getByText('uploadActivity.indexingSummary')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'uploadActivity.title' }));
    expect(screen.getByText(/45%/)).toBeInTheDocument();
    expect(screen.getByText('Storage offline')).toBeInTheDocument();
    expect(screen.queryByText('hidden.pdf')).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'uploadActivity.cancel' })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'uploadActivity.cancel' }));
    expect(cancelUpload).toHaveBeenCalledWith('pending');
    fireEvent.click(screen.getByRole('button', { name: 'uploadActivity.retry' }));
    expect(retryPageUpload).toHaveBeenCalledWith('failed', expect.objectContaining({ autoIndex: expect.any(Boolean), deepSearch: expect.any(Boolean) }));
    fireEvent.click(screen.getByRole('button', { name: 'uploadActivity.dismiss' }));
    expect(useWorkspaceStore.getState().uploadQueue.some((q) => q.id === 'failed')).toBe(true);
  });
});
