import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MessageAttachments } from './MessageAttachments';

const openFileViewerFromUrlMock = vi.hoisted(() => vi.fn());

vi.mock('@/modules/file-viewer', () => ({
  openFileViewerFromUrl: openFileViewerFromUrlMock,
  isViewableFile: () => true,
}));

describe('MessageAttachments', () => {
  it('opens viewable file in sidebar viewer', async () => {
    render(
      <MessageAttachments
        files={[
          {
            id: 'f1',
            originalName: 'report.pdf',
            mimeType: 'application/pdf',
            size: 123,
            downloadUrl: 'https://files.example/report.pdf',
          },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('link'));
    expect(openFileViewerFromUrlMock).toHaveBeenCalledWith('https://files.example/report.pdf', 'report.pdf', 'application/pdf', { displayMode: 'sidebar' });
  });
});
