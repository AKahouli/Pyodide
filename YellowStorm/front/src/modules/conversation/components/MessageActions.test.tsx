import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MessageActions } from './MessageActions';

const updateFeedbackMock = vi.hoisted(() => vi.fn());
const regenerateMessageMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const branchConversationMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const fetchConversationsMock = vi.hoisted(() => vi.fn());

vi.mock('@/components/ui/tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  Tooltip: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  TooltipContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  DropdownMenuItem: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => <button onClick={onClick} disabled={disabled}>{children}</button>,
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('../api', () => ({ branchConversation: branchConversationMock }));

vi.mock('../store', () => ({
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      updateFeedback: updateFeedbackMock,
      regenerateMessage: regenerateMessageMock,
      setReplyingToMessage: vi.fn(),
      currentConversation: { runtimeMode: 'standard' },
      messages: [
        { id: 'user-1', conversationType: 'user' },
        { id: 'ai-1', conversationType: 'ai', questionMessageId: 'user-1' },
      ],
      activeBranches: new Map([['user-1', 'ai-1']]),
      fetchConversations: fetchConversationsMock,
    }),
}));

vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof import('../utils')>('../utils');
  return {
    ...actual,
    componentsToMarkdown: () => 'markdown',
  };
});

vi.mock('./ReportDialog', () => ({ ReportDialog: () => null }));
vi.mock('./TimingIndicator', () => ({ TimingIndicator: () => <div>timing</div> }));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: vi.fn(),
  },
}));

describe('MessageActions', () => {
  it('handles like, copy, and regenerate actions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(
      <MessageActions
        message={{ id: 'ai-1', feedback: null, components: [], isComplete: false, isStreaming: false } as never}
        isLastAiMessage
        conversationId='conv-1'
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'messageActions.likeAria' }));
    expect(updateFeedbackMock).toHaveBeenCalledWith('conv-1', 'ai-1', 'like');

    await userEvent.click(screen.getByRole('button', { name: 'messageActions.copyAria' }));
    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('markdown');
      expect(toastSuccessMock).toHaveBeenCalledWith('toasts.message.copied');
    });

    await userEvent.click(screen.getByRole('button', { name: 'messageActions.regenerateAria' }));
    expect(regenerateMessageMock).toHaveBeenCalledWith('conv-1', 'ai-1');
  });

  it('branches from a completed response using the selected path', async () => {
    branchConversationMock.mockResolvedValueOnce({ id: 'branch-1' });
    render(
      <MessageActions
        message={{ id: 'ai-1', conversationType: 'ai', questionMessageId: 'user-1', components: [], isComplete: true, isStreaming: false } as never}
        isLastAiMessage={false}
        conversationId='conv-1'
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'messageActions.branch' }));

    await waitFor(() => expect(branchConversationMock).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        targetMessageId: 'ai-1',
        activeBranches: { 'user-1': 'ai-1' },
      }),
    ));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/conversation/branch-1'));
  });
});
