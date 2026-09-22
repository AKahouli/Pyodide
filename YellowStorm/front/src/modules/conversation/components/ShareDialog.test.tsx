import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareDialog } from './ShareDialog';

const createShareMock = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  createShare: createShareMock,
}));

vi.mock('../store', () => ({
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ refreshCurrentConversation: vi.fn(), fetchConversations: vi.fn() }),
}));

describe('ShareDialog', () => {
  beforeEach(() => vi.clearAllMocks());

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

  it('shares a conversation by email', async () => {
    createShareMock.mockResolvedValue({
      id: 's2',
      recipientEmails: ['person@example.com'],
    });
    render(<ShareDialog open onOpenChange={vi.fn()} conversationId='conv-1' conversationTitle='My conversation' />);

    const emailTab = screen.getByRole('tab', { name: 'dialogs.share.tabs.private' });
    expect(emailTab).toBeEnabled();
    await userEvent.click(emailTab);
    await userEvent.type(screen.getByPlaceholderText('dialogs.share.form.recipientPlaceholder'), 'person@example.com');
    await userEvent.click(screen.getByText('dialogs.share.form.shareWorkspaces'));
    await userEvent.click(screen.getByRole('button', { name: 'dialogs.share.actions.share' }));

    await waitFor(() => expect(createShareMock).toHaveBeenCalledWith('conv-1', {
      shareType: 'private',
      title: 'My conversation',
      recipientEmails: ['person@example.com'],
      shareWorkspaces: true,
    }));
  });
});
