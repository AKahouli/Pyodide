import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UserMessageActions } from './UserMessageActions';

const setEditingMessageMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());

vi.mock('../store', () => ({
  useConversationStore: (selector: (state: { setEditingMessage: (id: string) => void; isStreaming: boolean }) => unknown) =>
    selector({ setEditingMessage: setEditingMessageMock, isStreaming: false }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
  },
}));

describe('UserMessageActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('copies message content to clipboard and shows toast', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(
      <UserMessageActions
        message={{ id: 'm1', content: 'Hello world' } as never}
        isLastUserMessage
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'userMessageActions.copyAria' }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('Hello world');
      expect(toastSuccessMock).toHaveBeenCalledWith('toasts.message.copied');
    });
  });

  it('enables editing for last user message', async () => {
    render(
      <UserMessageActions
        message={{ id: 'm-edit', content: 'Edit me' } as never}
        isLastUserMessage
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'userMessageActions.editAria' }));
    expect(setEditingMessageMock).toHaveBeenCalledWith('m-edit');
  });
});
