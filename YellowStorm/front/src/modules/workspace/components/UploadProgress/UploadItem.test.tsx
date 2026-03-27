import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { UploadItem } from './UploadItem';

const cancelUploadMock = vi.fn();
const removeFromQueueMock = vi.fn();

vi.mock('../../store', () => ({
  useWorkspaceStore: (selector: (state: { cancelUpload: (id: string) => void; removeFromQueue: (id: string) => void }) => unknown) =>
    selector({
      cancelUpload: cancelUploadMock,
      removeFromQueue: removeFromQueueMock,
    }),
}));

describe('UploadItem', () => {
  it('cancels pending upload item', async () => {
    render(
      <UploadItem
        item={{
          id: 'up-1',
          workspaceId: 'ws-1',
          file: new File(['x'], 'doc.txt', { type: 'text/plain' }),
          progress: 0,
          status: 'pending',
        }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'upload.item.actions.cancel' }));
    expect(cancelUploadMock).toHaveBeenCalledWith('up-1');
  });
});
