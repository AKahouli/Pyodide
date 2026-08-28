import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageActions } from './MessageActions';

const updateFeedbackMock = vi.hoisted(() => vi.fn());
const regenerateMessageMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const branchConversationMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const fetchConversationsMock = vi.hoisted(() => vi.fn());
const modelMock = vi.hoisted(() => ({ value: { id: 'model-1', name: 'Model One' } as { id: string; name: string } | undefined }));
const buildPlaybookMock = vi.hoisted(() => vi.fn());

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
vi.mock('@/modules/auth', () => ({
  useAuth: () => ({ user: { id: 'user-owner', permissions: ['playbook.create'] } }),
}));
vi.mock('@/modules/playbook', () => ({ buildPlaybookFromConversation: buildPlaybookMock }));
vi.mock('../api', () => ({ branchConversation: branchConversationMock }));
vi.mock('@/modules/models', () => ({
  useModelById: (id: string) => id === 'model-1' ? modelMock.value : undefined,
}));

vi.mock('../store', () => ({
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      updateFeedback: updateFeedbackMock,
      regenerateMessage: regenerateMessageMock,
      setReplyingToMessage: vi.fn(),
      currentConversation: { runtimeMode: 'standard', createdBy: 'user-owner' },
      messages: [
        { id: 'user-1', conversationType: 'user', modelId: 'model-1', content: 'Design incident response' },
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
    componentsToMarkdown: (components: Array<{ data?: { content?: unknown } }>) => {
      const content = components.find((component) => typeof component.data?.content === 'string')?.data?.content;
      return typeof content === 'string' ? content : 'markdown';
    },
  };
});

vi.mock('./ReportDialog', () => ({ ReportDialog: () => null }));
vi.mock('./TimingIndicator', () => ({ TimingIndicator: () => <div>timing</div> }));
const pdfExportMock = vi.hoisted(() => ({ onFinish: null as null | ((ok: boolean) => void) }));
vi.mock('./MessagePdfExport', () => ({
  MessagePdfExport: ({ onFinish }: { onFinish: (ok: boolean) => void }) => {
    pdfExportMock.onFinish = onFinish;
    return <div data-testid='message-pdf-export' />;
  },
}));

vi.mock('sonner', () => ({
  toast: {
    success: toastSuccessMock,
    error: vi.fn(),
  },
}));

describe('MessageActions', () => {
  beforeEach(() => {
    modelMock.value = { id: 'model-1', name: 'Model One' };
    buildPlaybookMock.mockReset();
  });

  it('handles like, copy, and regenerate actions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(
      <MessageActions
        message={{ id: 'ai-1', feedback: null, components: [], isComplete: false, isStreaming: false, modelId: 'model-1', createdAt: '2026-07-29T13:00:00.000Z' } as never}
        isLastAiMessage
        conversationId='conv-1'
      />,
    );

    const actions = screen.getByRole('button', { name: 'messageActions.likeAria' }).parentElement;
    expect(actions).not.toHaveClass('opacity-0', 'group-hover/msg:opacity-100');
    expect(screen.getByText('Model One')).toBeInTheDocument();
    expect(screen.getByText(
      new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date('2026-07-29T13:00:00.000Z')),
    )).toBeInTheDocument();

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

    expect(screen.getByText('Model One')).toBeInTheDocument();

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

  it('builds a playbook from the paired conversation turn', async () => {
    buildPlaybookMock.mockResolvedValueOnce({ id: 'playbook-1' });
    render(
      <MessageActions
        message={{
          id: 'ai-1',
          conversationType: 'ai',
          questionMessageId: 'user-1',
          components: [{ type: 'text', data: { content: 'Triage and recover' } }],
          isComplete: true,
          isStreaming: false,
          createdAt: '2026-07-29T13:00:00.000Z',
        } as never}
        isLastAiMessage={false}
        conversationId='conv-1'
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'messageActions.buildPlaybook' }));
    expect(await screen.findByText('buildPlaybookDialog.userPrompt')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'buildPlaybookDialog.build' }));

    await waitFor(() => expect(buildPlaybookMock).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      assistantMessageId: 'ai-1',
      answerVersion: 'original',
    }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/playbooks/playbook-1'));
  });

  it('previews and submits the explicitly displayed answer version', async () => {
    render(
      <MessageActions
        message={{
          id: 'ai-1',
          conversationType: 'ai',
          questionMessageId: 'user-1',
          components: [{ type: 'text', data: { content: 'Original answer' } }],
          correctionWorkflow: {
            activeVersion: 'corrected',
            publishedAttemptId: 'attempt-2',
            attempts: [{
              attemptId: 'attempt-2',
              components: [{ type: 'text', data: { content: 'Corrected answer' } }],
            }],
          },
          isComplete: true,
          isStreaming: false,
          createdAt: '2026-07-29T13:00:00.000Z',
        } as never}
        displayedVersion='original'
        isLastAiMessage={false}
        conversationId='conv-1'
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'messageActions.buildPlaybook' }));

    expect(await screen.findByText('Original answer')).toBeInTheDocument();
    expect(screen.queryByText('Corrected answer')).not.toBeInTheDocument();
  });

  it('exports a completed response to PDF from the actions menu', async () => {
    render(
      <MessageActions
        message={{ id: 'ai-1', conversationType: 'ai', questionMessageId: 'user-1', components: [], isComplete: true, isStreaming: false, createdAt: '2026-07-29T13:00:00.000Z' } as never}
        isLastAiMessage={false}
        conversationId='conv-1'
      />,
    );

    const exportButton = screen.getByRole('button', { name: 'messageActions.export' });
    expect(exportButton).toBeEnabled();

    await userEvent.click(exportButton);
    expect(await screen.findByTestId('message-pdf-export')).toBeInTheDocument();

    // The export overlay unmounts once the print flow reports completion.
    act(() => pdfExportMock.onFinish?.(true));
    await waitFor(() => expect(screen.queryByTestId('message-pdf-export')).not.toBeInTheDocument());
  });

  it('falls back safely when generation metadata cannot be resolved', () => {
    modelMock.value = undefined;
    const { rerender } = render(
      <MessageActions
        message={{ id: 'ai-1', conversationType: 'ai', components: [], modelId: 'retired-model', createdAt: 'invalid' } as never}
        isLastAiMessage={false}
        conversationId='conv-1'
      />,
    );

    expect(screen.getByText('retired-model')).toBeInTheDocument();
    expect(screen.getByText('messageActions.dateUnavailable')).toBeInTheDocument();

    rerender(
      <MessageActions
        message={{ id: 'ai-1', conversationType: 'ai', components: [], createdAt: 'invalid' } as never}
        isLastAiMessage={false}
        conversationId='conv-1'
      />,
    );
    expect(screen.getByText('messageActions.modelUnavailable')).toBeInTheDocument();
  });
});
