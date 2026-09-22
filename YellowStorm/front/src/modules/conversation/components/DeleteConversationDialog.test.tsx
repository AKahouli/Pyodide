import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DeleteConversationDialog } from './DeleteConversationDialog';

describe('DeleteConversationDialog', () => {
  it('confirms delete and closes when action succeeds', async () => {
    const onOpenChange = vi.fn();
    const onConfirm = vi.fn().mockResolvedValue(undefined);

    render(<DeleteConversationDialog open onOpenChange={onOpenChange} onConfirm={onConfirm} title='Test chat' />);

    await userEvent.click(screen.getByRole('button', { name: 'actionDelete' }));

    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });
  });

  it('warns about revoked access when the conversation is shared', () => {
    render(
      <DeleteConversationDialog
        open
        onOpenChange={vi.fn()}
        onConfirm={vi.fn().mockResolvedValue(undefined)}
        title='Shared chat'
        isShared
      />,
    );

    expect(screen.getByText('dialogs.delete.sharedWarning')).toBeInTheDocument();
  });

  it('does not show the shared warning for a private conversation', () => {
    render(
      <DeleteConversationDialog open onOpenChange={vi.fn()} onConfirm={vi.fn().mockResolvedValue(undefined)} title='Private chat' />,
    );

    expect(screen.queryByText('dialogs.delete.sharedWarning')).not.toBeInTheDocument();
  });
});
