import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageActions } from './MessageActions';

const updateFeedbackMock = vi.hoisted(() => vi.fn());
const regenerateMessageMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const branchConversationMock = vi.hoisted(() => vi.fn());
const prepareConversationPlaybookHandoffMock = vi.hoisted(() => vi.fn());
const openHandoffMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const fetchConversationsMock = vi.hoisted(() => vi.fn());
const openCitationSourceMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const exportBlocksToDocxMock = vi.hoisted(() => vi.fn().mockResolvedValue(new Blob(['docx'])));
const downloadBlobMock = vi.hoisted(() => vi.fn());
const notificationSuccessMock = vi.hoisted(() => vi.fn());
const notificationErrorMock = vi.hoisted(() => vi.fn());
const modelMock = vi.hoisted(() => ({ value: { id: 'model-1', name: 'Model One' } as { id: string; name: string } | undefined }));

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

vi.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/ai-elements/ai-message-content', () => ({
  openCitationSource: openCitationSourceMock,
}));

vi.mock('../utils/docx-export', () => ({
  exportBlocksToDocx: exportBlocksToDocxMock,
  downloadBlob: downloadBlobMock,
}));

vi.mock('@/lib/notifications', () => ({
  showSuccess: notificationSuccessMock,
  showError: notificationErrorMock,
  showInfo: vi.fn(),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => navigateMock }));
vi.mock('@/modules/auth', () => ({
  useAuth: () => ({ user: { id: 'user-owner', permissions: ['playbook.create'] } }),
}));
vi.mock('../api', () => ({
  branchConversation: branchConversationMock,
  prepareConversationPlaybookHandoff: prepareConversationPlaybookHandoffMock,
}));
vi.mock('@/modules/models', () => ({
  useModelById: (id: string) => id === 'model-1' ? modelMock.value : undefined,
}));
vi.mock('@/modules/playbook/features', () => ({ playbookFeatures: { mcpAssistantEnabled: true } }));
vi.mock('@/modules/platform-copilot/platformCopilotPanelStore', () => ({
  usePlatformCopilotPanelStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ openHandoff: openHandoffMock }),
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
    error: toastErrorMock,
  },
}));

describe('MessageActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelMock.value = { id: 'model-1', name: 'Model One' };
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

  it('prepares a canonical branch handoff and opens Yellowmind', async () => {
    const handoff = {
      contractVersion: 1,
      status: 'prepared',
      handoffId: crypto.randomUUID(),
      platformConversationId: 'platform-1',
      suggestedPrompt: 'Create a reusable Playbook',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      preview: { executionSummaries: [], planSteps: [], actions: [], resources: [], omissions: {} },
      provenance: {},
    };
    prepareConversationPlaybookHandoffMock.mockResolvedValueOnce(handoff);
    render(
      <MessageActions
        message={{ id: 'ai-1', conversationType: 'ai', questionMessageId: 'user-1', components: [], isComplete: true, isStreaming: false } as never}
        isLastAiMessage={false}
        conversationId='conv-1'
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'messageActions.playbookHandoff' }));

    await waitFor(() => expect(prepareConversationPlaybookHandoffMock).toHaveBeenCalledWith(
      'conv-1',
      expect.objectContaining({
        contractVersion: 1,
        targetMessageId: 'ai-1',
        displayedAnswerVersion: 'original',
        activeBranches: { 'user-1': 'ai-1' },
        branchSelectionFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        creationRequestId: expect.any(String),
      }),
    ));
    await waitFor(() => expect(openHandoffMock).toHaveBeenCalledWith(handoff));
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

  it('lists cited sources and opens them in the document viewer', async () => {
    render(
      <MessageActions
        message={{
          id: 'ai-1',
          conversationType: 'ai',
          components: [
            { type: 'text', data: { content: 'answer', citations: [{ source: 'docs/impl-guide.pdf', page: '4', parentId: '', sourceType: 'text', externalId: '', pageContent: '', workspaceId: '' }, { source: 'https://example.com/spec', parentId: '', sourceType: 'text', externalId: '', page: '', pageContent: '', workspaceId: '' }] } },
          ],
          isComplete: true,
          isStreaming: false,
        } as never}
        isLastAiMessage={false}
        conversationId='conv-1'
      />,
    );

    expect(screen.getByText('messageActions.sources')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /impl-guide\.pdf/ }));
    await waitFor(() => expect(openCitationSourceMock).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'docs/impl-guide.pdf' }),
      'sidebar',
      'ai.citations.defaultSource',
      { conversationId: 'conv-1', messageId: 'ai-1' },
    ));
    expect(screen.getByRole('button', { name: 'spec' })).toBeInTheDocument();
  });

  it('lists each source document once, without page numbers', () => {
    render(
      <MessageActions
        message={{
          id: 'ai-1',
          conversationType: 'ai',
          components: [
            { type: 'text', data: { content: 'answer', citations: [
              { source: 'docs/impl-guide.pdf', page: '3', parentId: '', sourceType: 'text', externalId: '', pageContent: '', workspaceId: '' },
              { source: 'docs/impl-guide.pdf', page: '7', reference: '[2]', parentId: '', sourceType: 'text', externalId: '', pageContent: '', workspaceId: '' },
              { source: 'https://example.com/spec', parentId: '', sourceType: 'text', externalId: '', page: '', pageContent: '', workspaceId: '' },
            ] } },
          ],
          isComplete: true,
          isStreaming: false,
        } as never}
        isLastAiMessage={false}
        conversationId='conv-1'
      />,
    );

    expect(screen.getAllByRole('button', { name: /impl-guide\.pdf/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'spec' })).toBeInTheDocument();
    expect(screen.queryByText('3')).not.toBeInTheDocument();
    expect(screen.queryByText('7')).not.toBeInTheDocument();
  });

  it('hides the sources button when the answer has no citations', () => {
    render(
      <MessageActions
        message={{ id: 'ai-1', conversationType: 'ai', components: [], isComplete: true, isStreaming: false } as never}
        isLastAiMessage={false}
        conversationId='conv-1'
      />,
    );
    expect(screen.queryByRole('button', { name: 'messageActions.sources' })).not.toBeInTheDocument();
  });

  it('exports the answer to DOCX', async () => {
    render(
      <MessageActions
        message={{ id: 'ai-1', conversationType: 'ai', components: [], isComplete: true, isStreaming: false, createdAt: '2026-07-29T13:00:00.000Z' } as never}
        isLastAiMessage={false}
        conversationId='conv-1'
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'messageActions.exportDocx' }));
    await waitFor(() => {
      expect(exportBlocksToDocxMock).toHaveBeenCalledWith(
        [{
          label: 'export.assistantLabel',
          timestamp: new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date('2026-07-29T13:00:00.000Z')),
          markdown: 'markdown',
        }],
        'exportPdf.untitledConversation',
      );
      expect(downloadBlobMock).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/\.docx$/));
      expect(notificationSuccessMock).toHaveBeenCalledWith('toasts.export.docxSuccess');
    });
  });

  it('exports the answer to HTML', async () => {
    render(
      <MessageActions
        message={{ id: 'ai-1', conversationType: 'ai', components: [], isComplete: true, isStreaming: false, createdAt: '2026-07-29T13:00:00.000Z' } as never}
        isLastAiMessage={false}
        conversationId='conv-1'
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'messageActions.exportHtml' }));
    expect(downloadBlobMock).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/\.html$/));
    expect(notificationSuccessMock).toHaveBeenCalledWith('toasts.export.htmlSuccess');
  });

  it('exports the answer to PDF via the print pipeline', async () => {
    render(
      <MessageActions
        message={{ id: 'ai-1', conversationType: 'ai', components: [], isComplete: true, isStreaming: false, createdAt: '2026-07-29T13:00:00.000Z' } as never}
        isLastAiMessage={false}
        conversationId='conv-1'
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'messageActions.exportPdf' }));
    expect(screen.getByTestId('message-pdf-export')).toBeInTheDocument();

    await act(async () => pdfExportMock.onFinish?.(false));
    expect(toastErrorMock).toHaveBeenCalledWith('toasts.message.exportError');
  });
});
