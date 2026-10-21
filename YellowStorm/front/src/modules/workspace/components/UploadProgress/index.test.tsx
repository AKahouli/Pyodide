import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UploadProgress } from './index';

vi.mock('../../store', () => ({
  useUploadQueue: () => [{ id: 'u1', file: new File(['x'], 'a.txt'), progress: 50, status: 'uploading' }],
  useHasActiveUploads: () => true,
  useWorkspaceStore: (selector: (state: { clearCompletedUploads: () => void }) => unknown) =>
    selector({ clearCompletedUploads: vi.fn() }),
}));

vi.mock('./UploadItem', () => ({
  UploadItem: () => <div>upload-item</div>,
}));

describe('UploadProgress', () => {
  afterEach(() => { window.location.hash = ''; });
  it('renders upload list when queue has items', () => {
    render(<UploadProgress />);
    expect(screen.getByText('upload-item')).toBeInTheDocument();
  });

  it('defers to the inline activity panel on a workspace page', () => {
    window.location.hash = '#/workspace/example-id';
    render(<UploadProgress />);
    expect(screen.queryByText('upload-item')).not.toBeInTheDocument();
  });
});
