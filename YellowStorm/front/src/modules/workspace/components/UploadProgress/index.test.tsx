import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
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
  it('renders upload list when queue has items', () => {
    render(<UploadProgress />);
    expect(screen.getByText('upload-item')).toBeInTheDocument();
  });
});
