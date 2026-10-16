import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ShareDialog } from './ShareDialog';

vi.mock('@/modules/auth', () => ({ useAuth: () => ({ user: { id: 'owner-1', email: 'owner@example.com' } }) }));

const createShareMock = vi.hoisted(() => vi.fn());
const searchRecipientsMock = vi.hoisted(() => vi.fn());
const sharesMock = vi.hoisted(() => vi.fn());
const revokeRecipientMock = vi.hoisted(() => vi.fn());

vi.mock('../api', () => ({
  createShare: createShareMock,
  getShares: sharesMock,
  revokeShare: vi.fn().mockResolvedValue(undefined),
  revokeShareRecipient: revokeRecipientMock,
  searchShareRecipients: searchRecipientsMock,
}));

vi.mock('../store', () => ({
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ refreshCurrentConversation: vi.fn(), fetchConversations: vi.fn() }),
}));

describe('ShareDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    searchRecipientsMock.mockResolvedValue([{ id: 'recipient-1', email: 'person@example.com', firstName: 'Person' }]);
    sharesMock.mockResolvedValue([]);
    revokeRecipientMock.mockResolvedValue(undefined);
  });

  it('still creates a public share link from the public tab', async () => {
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

    await userEvent.click(screen.getByRole('tab', { name: 'dialogs.share.tabs.public' }));
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
    await userEvent.type(screen.getByPlaceholderText('dialogs.share.form.searchPlaceholder'), 'person');
    await userEvent.click(await screen.findByRole('button', { name: /person@example.com/ }));
    await userEvent.click(screen.getByText('dialogs.share.form.shareWorkspaces'));
    await userEvent.click(screen.getByRole('button', { name: 'dialogs.share.actions.share' }));

    await waitFor(() => expect(createShareMock).toHaveBeenCalledWith('conv-1', {
      shareType: 'private',
      title: 'My conversation',
      recipientEmails: ['person@example.com'],
      shareWorkspaces: true,
    }));
  });

  it('limits governed sharing to people and hides workspace access', async () => {
    createShareMock.mockResolvedValue({ id: 's3', recipientEmails: ['person@example.com'] });
    render(<ShareDialog open governed onOpenChange={vi.fn()} conversationId='conv-1' conversationTitle='Governed' />);
    expect(screen.queryByRole('tab', { name: 'dialogs.share.tabs.public' })).not.toBeInTheDocument();
    expect(screen.queryByText('dialogs.share.form.shareWorkspaces')).not.toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText('dialogs.share.form.searchPlaceholder'), 'person');
    await userEvent.click(await screen.findByRole('button', { name: /person@example.com/ }));
    await userEvent.click(screen.getByRole('button', { name: 'dialogs.share.actions.share' }));
    await waitFor(() => expect(createShareMock).toHaveBeenCalledWith('conv-1', {
      shareType: 'private', title: 'Governed', recipientEmails: ['person@example.com'],
    }));
  });

  it('removes only the selected person from a multi-person share', async () => {
    sharesMock.mockResolvedValue([{ id: 'share-1', shareType: 'private', isRevoked: false,
      recipientEmails: ['one@example.com', 'two@example.com'], recipientUserIds: ['one', 'two'] }]);
    render(<ShareDialog open governed onOpenChange={vi.fn()} conversationId='conv-1' conversationTitle='Governed' />);
    await userEvent.click(await screen.findByRole('button', { name: 'dialogs.share.revoke one@example.com' }));
    await waitFor(() => expect(revokeRecipientMock).toHaveBeenCalledWith('conv-1', 'share-1', 'one'));
  });
});
