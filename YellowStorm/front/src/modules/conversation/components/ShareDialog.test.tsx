import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ShareDialog } from './ShareDialog';

const createShareMock = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  createShare: createShareMock,
}));

describe('ShareDialog', () => {
  it('creates public share link from default tab', async () => {
    createShareMock.mockResolvedValue({
      id: 's1',
      accessToken: 'token-1',
      expiresAt: new Date().toISOString(),
      recipientEmails: [],
    });

    render(
      <ShareDialog
        open
        onOpenChange={vi.fn()}
        conversationId='conv-1'
        conversationTitle='My conversation'
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'dialogs.share.actions.generateLink' }));

    await waitFor(() => {
      expect(createShareMock).toHaveBeenCalledWith('conv-1', {
        shareType: 'public',
        title: 'My conversation',
        expiresInDays: 30,
      });
    });
  });
});
