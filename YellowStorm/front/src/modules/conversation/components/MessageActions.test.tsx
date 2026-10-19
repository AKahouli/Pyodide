import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageActions } from './MessageActions';
import * as documentExports from '../utils/document-export';

const updateFeedbackMock = vi.hoisted(() => vi.fn());
const regenerateMessageMock = vi.hoisted(() => vi.fn());
const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const branchConversationMock = vi.hoisted(() => vi.fn());
const prepareConversationPlaybookHandoffMock = vi.hoisted(() => vi.fn());
const fetchMessagesMock = vi.hoisted(() => vi.fn().mockResolvedValue({ items: [], hasMore: false }));
const openHandoffMock = vi.hoisted(() => vi.fn());
const navigateMock = vi.hoisted(() => vi.fn());
const fetchConversationsMock = vi.hoisted(() => vi.fn());
const openCitationSourceMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const exportBlocksToDocxMock = vi.hoisted(() => vi.fn().mockResolvedValue(new Blob(['docx'])));
const downloadBlobMock = vi.hoisted(() => vi.fn());
const notificationSuccessMock = vi.hoisted(() => vi.fn());
const notificationErrorMock = vi.hoisted(() => vi.fn());
const sendMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const authActor = vi.hoisted(() => ({ id: 'user-owner' }));
const conversationState = vi.hoisted(() => ({ currentConversationId: 'conv-1', runtimeMode: 'standard', isStreaming: false, isAwaitingFirstChunk: false }));
const modelMock = vi.hoisted(() => ({
  value: { id: 'model-1', name: 'Model One' } as { id: string; name: string } | undefined,
}));

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
  DropdownMenuItem: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
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
vi.mock('@/modules/localization', async () => ({
  ...await vi.importActual<typeof import('@/modules/localization')>('@/modules/localization'),
  useModuleTranslation: () => ({ t: (key: string, options?: unknown) => key === 'messageActions.exportAgentRequest' ? JSON.stringify(options) : key, language: 'en', ready: true }),
}));
vi.mock('@/modules/auth', () => ({
  useAuth: () => ({
    user: { id: authActor.id, permissions: ['playbook.create'] },
  }),
}));
vi.mock('../api', () => ({
  fetchMessages: fetchMessagesMock,
  branchConversation: branchConversationMock,
  prepareConversationPlaybookHandoff: prepareConversationPlaybookHandoffMock,
}));
vi.mock('@/modules/models', () => ({
  useModelById: (id: string) => (id === 'model-1' ? modelMock.value : undefined),
}));
vi.mock('@/modules/admin/featureVisibilityStore', () => ({
  useFeatureVisibilityStore: (selector: (state: { visibility: { playbookMcpAssistant: boolean; platformCopilot: boolean } }) => unknown) => selector({ visibility: { playbookMcpAssistant: true, platformCopilot: true } }),
}));
vi.mock('@/modules/platform-copilot/platformCopilotPanelStore', () => ({
  usePlatformCopilotPanelStore: (selector: (state: Record<string, unknown>) => unknown) => selector({ openHandoff: openHandoffMock }),
}));

vi.mock('../store', () => ({
  useConversationStore: Object.assign((selector: (state: Record<string, unknown>) => unknown) =>
    selector({
      currentConversationId: conversationState.currentConversationId,
      isStreaming: conversationState.isStreaming,
      isAwaitingFirstChunk: conversationState.isAwaitingFirstChunk,
      sendMessage: sendMessageMock,
      updateFeedback: updateFeedbackMock,
      regenerateMessage: regenerateMessageMock,
      setReplyingToMessage: vi.fn(),
      currentConversation: { runtimeMode: conversationState.runtimeMode, createdBy: 'user-owner' },
      messages: [
        {
          id: 'user-1',
          conversationType: 'user',
          modelId: 'model-1',
          content: 'Design incident response',
        },
        { id: 'ai-1', conversationType: 'ai', questionMessageId: 'user-1' },
      ],
      activeBranches: new Map([['user-1', 'ai-1']]),
      fetchConversations: fetchConversationsMock,
      conversationUsage: {
        tokens: {
          input: 93_210,
          output: 31_505,
          cachedInput: 4_019,
          reasoning: 0,
          total: 128_734,
        },
        cost: { usd: 0.287, complete: true },
        carbon: { gramsCo2e: 6.2, estimated: true, complete: true },
      },
    }), { getState: () => ({ ...conversationState, currentConversation: { runtimeMode: conversationState.runtimeMode } }) }),
}));

vi.mock('../utils', async () => {
  const actual = await vi.importActual<typeof import('../utils')>('../utils');
  return {
    ...actual,
    componentsToMarkdown: (components: Array<{ data?: { content?: unknown } }>, projectText?: (component: unknown) => string | undefined) => {
      const component = components.find((candidate) => typeof candidate.data?.content === 'string');
      const content = component ? projectText?.(component) ?? component.data?.content : undefined;
      return typeof content === 'string' ? content : 'markdown';
    },
  };
});

vi.mock('./ReportDialog', () => ({ ReportDialog: () => null }));
vi.mock('./TimingIndicator', () => ({
  TimingIndicator: () => <div>timing</div>,
}));
const pdfExportMock = vi.hoisted(() => ({
  onFinish: null as null | ((ok: boolean) => void),
}));
vi.mock('./PdfExportPortal', () => ({
  PdfExportPortal: ({ onFinish }: { onFinish: (ok: boolean) => void }) => {
    pdfExportMock.onFinish = onFinish;
    return <div data-testid="message-pdf-export" />;
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
    authActor.id = 'user-owner';
    modelMock.value = { id: 'model-1', name: 'Model One' };
    Object.assign(conversationState, { currentConversationId: 'conv-1', runtimeMode: 'standard', isStreaming: false, isAwaitingFirstChunk: false });
  });

  it('handles like, copy, and regenerate actions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    render(
      <MessageActions
        message={
          {
            id: 'ai-1',
            feedback: null,
            components: [],
            isComplete: false,
            isStreaming: false,
            modelId: 'model-1',
            createdAt: '2026-07-29T13:00:00.000Z',
          } as never
        }
        isLastAiMessage
        conversationId="conv-1"
      />,
    );

    const actions = screen.getByRole('button', {
      name: 'messageActions.likeAria',
    }).parentElement;
    expect(actions).not.toHaveClass('opacity-0', 'group-hover/msg:opacity-100');
    expect(screen.getByText('Model One')).toBeInTheDocument();
    expect(screen.getByText('128.7K tokens')).toBeInTheDocument();
    expect(screen.getByText('· $0.287')).toBeInTheDocument();
    expect(screen.getByText('· ≈ 6.2 gCO₂e')).not.toHaveClass('hidden');
    expect(document.querySelector('[data-conversation-usage-summary]')).toHaveClass('w-full', 'shrink-0', 'flex-wrap', 'sm:w-auto', 'sm:shrink', 'sm:flex-nowrap');
    expect(
      screen.getByText(
        new Intl.DateTimeFormat('en', {
          dateStyle: 'medium',
          timeStyle: 'medium',
        }).format(new Date('2026-07-29T13:00:00.000Z')),
      ),
    ).toBeInTheDocument();

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

  it('copies the rendered text of an OpenUI answer instead of its program', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    document.body.innerHTML = '<div id="message-ai-openui"><div data-openui-scope><p>Revenue grew 12%.</p></div></div>';
    try {
      render(
        <MessageActions
          message={{ id: 'ai-openui', feedback: null, isComplete: true, isStreaming: false, modelId: 'model-1', createdAt: '2026-07-29T13:00:00.000Z',
            components: [{ id: 'text-1', type: 'text', data: { content: 'root = Stack([a])\na = TextContent(\"Revenue grew 12%.\")' } }] } as never}
          isLastAiMessage
          conversationId="conv-1"
        />,
      );
      await userEvent.click(screen.getByRole('button', { name: 'messageActions.copyAria' }));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith('Revenue grew 12%.'));
    } finally {
      document.body.innerHTML = '';
    }
  });

  it('branches from a completed response using the selected path', async () => {
    branchConversationMock.mockResolvedValueOnce({ id: 'branch-1' });
    render(
      <MessageActions
        message={
          {
            id: 'ai-1',
            conversationType: 'ai',
            questionMessageId: 'user-1',
            components: [],
            isComplete: true,
            isStreaming: false,
          } as never
        }
        isLastAiMessage={false}
        conversationId="conv-1"
      />,
    );

    expect(screen.getByText('Model One')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'messageActions.branch' }));

    await waitFor(() =>
      expect(branchConversationMock).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          targetMessageId: 'ai-1',
          activeBranches: { 'user-1': 'ai-1' },
        }),
      ),
    );
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
      preview: {
        executionSummaries: [],
        planSteps: [],
        actions: [],
        resources: [],
        omissions: {},
      },
      provenance: {},
    };
    prepareConversationPlaybookHandoffMock.mockResolvedValueOnce(handoff);
    render(
      <MessageActions
        message={
          {
            id: 'ai-1',
            conversationType: 'ai',
            questionMessageId: 'user-1',
            components: [],
            isComplete: true,
            isStreaming: false,
          } as never
        }
        isLastAiMessage={false}
        conversationId="conv-1"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'messageActions.playbookHandoff' }));

    await waitFor(() =>
      expect(prepareConversationPlaybookHandoffMock).toHaveBeenCalledWith(
        'conv-1',
        expect.objectContaining({
          contractVersion: 1,
          targetMessageId: 'ai-1',
          displayedAnswerVersion: 'original',
          activeBranches: { 'user-1': 'ai-1' },
          branchSelectionFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
          creationRequestId: expect.any(String),
        }),
      ),
    );
    await waitFor(() => expect(openHandoffMock).toHaveBeenCalledWith(handoff));
  });

  it('shows the actual inference model when an explicitly tagged agent differs from the composer model', () => {
    render(
      <MessageActions
        message={
          {
            id: 'ai-tagged',
            conversationType: 'ai',
            components: [],
            modelId: 'model-1',
            modelRequestTelemetry: { model: 'gpt-6-luna', usedTokens: 100, contextWindow: 1000 },
            createdAt: '2026-07-29T13:00:00.000Z',
          } as never
        }
        isLastAiMessage={false}
        conversationId="conv-1"
      />,
    );

    expect(screen.getByText('gpt-6-luna')).toBeInTheDocument();
    expect(screen.queryByText('Model One')).not.toBeInTheDocument();
  });

  it('resolves the catalog name for the reported inference model', () => {
    render(
      <MessageActions
        message={
          {
            id: 'ai-tagged-known', conversationType: 'ai', components: [], modelId: 'other-composer-model',
            modelRequestTelemetry: { model: 'model-1', usedTokens: 100, contextWindow: 1000 },
            createdAt: '2026-07-29T13:00:00.000Z',
          } as never
        }
        isLastAiMessage={false}
        conversationId="conv-1"
      />,
    );

    expect(screen.getByText('Model One')).toBeInTheDocument();
    expect(screen.queryByText('other-composer-model')).not.toBeInTheDocument();
  });

  it('falls back safely when generation metadata cannot be resolved', () => {
    modelMock.value = undefined;
    const { rerender } = render(
      <MessageActions
        message={
          {
            id: 'ai-1',
            conversationType: 'ai',
            components: [],
            modelId: 'retired-model',
            createdAt: 'invalid',
          } as never
        }
        isLastAiMessage={false}
        conversationId="conv-1"
      />,
    );

    expect(screen.getByText('retired-model')).toBeInTheDocument();
    expect(screen.getByText('messageActions.dateUnavailable')).toBeInTheDocument();

    rerender(
      <MessageActions
        message={
          {
            id: 'ai-1',
            conversationType: 'ai',
            components: [],
            createdAt: 'invalid',
          } as never
        }
        isLastAiMessage={false}
        conversationId="conv-1"
      />,
    );
    expect(screen.getByText('messageActions.modelUnavailable')).toBeInTheDocument();
  });

  it('lists cited sources and opens them in the document viewer', async () => {
    render(
      <MessageActions
        message={
          {
            id: 'ai-1',
            conversationType: 'ai',
            components: [
              {
                type: 'text',
                data: {
                  content: 'answer',
                  citations: [
                    {
                      source: 'docs/impl-guide.pdf',
                      page: '4',
                      parentId: '',
                      sourceType: 'text',
                      externalId: '',
                      pageContent: '',
                      workspaceId: '',
                    },
                    {
                      source: 'https://example.com/spec',
                      parentId: '',
                      sourceType: 'text',
                      externalId: '',
                      page: '',
                      pageContent: '',
                      workspaceId: '',
                    },
                  ],
                },
              },
            ],
            isComplete: true,
            isStreaming: false,
          } as never
        }
        isLastAiMessage={false}
        conversationId="conv-1"
      />,
    );

    expect(screen.getByText('messageActions.sources')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /impl-guide\.pdf/ }));
    await waitFor(() => expect(openCitationSourceMock).toHaveBeenCalledWith(expect.objectContaining({ source: 'docs/impl-guide.pdf' }), 'sidebar', 'ai.citations.defaultSource', { conversationId: 'conv-1', messageId: 'ai-1' }));
    expect(screen.getByRole('button', { name: 'spec' })).toBeInTheDocument();
  });

  it('lists each source document once, without page numbers', () => {
    render(
      <MessageActions
        message={
          {
            id: 'ai-1',
            conversationType: 'ai',
            components: [
              {
                type: 'text',
                data: {
                  content: 'answer',
                  citations: [
                    {
                      source: 'docs/impl-guide.pdf',
                      page: '3',
                      parentId: '',
                      sourceType: 'text',
                      externalId: '',
                      pageContent: '',
                      workspaceId: '',
                    },
                    {
                      source: 'docs/impl-guide.pdf',
                      page: '7',
                      reference: '[2]',
                      parentId: '',
                      sourceType: 'text',
                      externalId: '',
                      pageContent: '',
                      workspaceId: '',
                    },
                    {
                      source: 'https://example.com/spec',
                      parentId: '',
                      sourceType: 'text',
                      externalId: '',
                      page: '',
                      pageContent: '',
                      workspaceId: '',
                    },
                  ],
                },
              },
            ],
            isComplete: true,
            isStreaming: false,
          } as never
        }
        isLastAiMessage={false}
        conversationId="conv-1"
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
        message={
          {
            id: 'ai-1',
            conversationType: 'ai',
            components: [],
            isComplete: true,
            isStreaming: false,
          } as never
        }
        isLastAiMessage={false}
        conversationId="conv-1"
      />,
    );
    expect(screen.queryByRole('button', { name: 'messageActions.sources' })).not.toBeInTheDocument();
  });

  it('exports the answer to DOCX', async () => {
    render(
      <MessageActions
        message={
          {
            id: 'ai-1',
            conversationType: 'ai',
            components: [],
            isComplete: true,
            isStreaming: false,
            createdAt: '2026-07-29T13:00:00.000Z',
          } as never
        }
        isLastAiMessage={false}
        conversationId="conv-1"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'messageActions.exportDocx' }));
    await waitFor(() => {
      expect(exportBlocksToDocxMock).toHaveBeenCalledWith(
        [
          {
            role: 'ai',
            label: 'export.assistantLabel',
            timestamp: new Intl.DateTimeFormat('en', {
              dateStyle: 'medium',
              timeStyle: 'medium',
            }).format(new Date('2026-07-29T13:00:00.000Z')),
            markdown: 'markdown',
            components: [],
          },
        ],
        'exportPdf.untitledConversation',
      );
      expect(downloadBlobMock).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/\.docx$/));
      expect(notificationSuccessMock).toHaveBeenCalledWith('toasts.export.docxSuccess');
    });
  });

  it.each(['actor change', 'unmount'])('does not download a private DOCX after %s during document construction', async transition => {
    let finish!: (blob: Blob) => void;
    exportBlocksToDocxMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const message = { id: 'ai-private', conversationType: 'ai', components: [], isComplete: true, isStreaming: false, createdAt: '2026-07-29T13:00:00.000Z' };
    const mounted = render(<MessageActions message={message as never} isLastAiMessage={false} conversationId='conv-1' />);
    await userEvent.click(screen.getByRole('button', { name: 'messageActions.exportDocx' }));
    await waitFor(() => expect(exportBlocksToDocxMock).toHaveBeenCalled());
    if (transition === 'unmount') mounted.unmount();
    else {
      authActor.id = 'other';
      mounted.rerender(<MessageActions message={{ ...message } as never} isLastAiMessage={false} conversationId='conv-1' />);
    }
    await act(async () => finish(new Blob(['private docx'])));
    expect(downloadBlobMock).not.toHaveBeenCalled();
    expect(notificationSuccessMock).not.toHaveBeenCalled();
    expect(notificationErrorMock).toHaveBeenCalledWith('toasts.export.failed');
  });
  it('unmounts a pending PDF portal when the actor changes', async () => {
    const message = { id: 'ai-private', conversationType: 'ai', components: [], isComplete: true, isStreaming: false, createdAt: '2026-07-29T13:00:00.000Z' };
    const mounted = render(<MessageActions message={message as never} isLastAiMessage={false} conversationId='conv-1' />);
    await userEvent.click(screen.getByRole('button', { name: 'messageActions.exportPdf' }));
    expect(await screen.findByTestId('message-pdf-export')).toBeInTheDocument();
    authActor.id = 'other';
    mounted.rerender(<MessageActions message={{ ...message } as never} isLastAiMessage={false} conversationId='conv-1' />);
    expect(screen.queryByTestId('message-pdf-export')).toBeNull();
    authActor.id = 'user-owner';
    mounted.rerender(<MessageActions message={{ ...message } as never} isLastAiMessage={false} conversationId='conv-1' />);
    expect(screen.queryByTestId('message-pdf-export')).toBeNull();
  });
  it('exports the answer to HTML', async () => {
    render(
      <MessageActions
        message={
          {
            id: 'ai-1',
            conversationType: 'ai',
            components: [],
            isComplete: true,
            isStreaming: false,
            createdAt: '2026-07-29T13:00:00.000Z',
          } as never
        }
        isLastAiMessage={false}
        conversationId="conv-1"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'messageActions.exportHtml' }));
    expect(downloadBlobMock).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/\.html$/));
    expect(notificationSuccessMock).toHaveBeenCalledWith('toasts.export.htmlSuccess');
  });

  it('exports the answer to PDF via the print pipeline', async () => {
    render(
      <MessageActions
        message={
          {
            id: 'ai-1',
            conversationType: 'ai',
            components: [],
            isComplete: true,
            isStreaming: false,
            createdAt: '2026-07-29T13:00:00.000Z',
          } as never
        }
        isLastAiMessage={false}
        conversationId="conv-1"
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'messageActions.exportPdf' }));
    expect(screen.getByTestId('message-pdf-export')).toBeInTheDocument();

    await act(async () => pdfExportMock.onFinish?.(false));
    expect(toastErrorMock).toHaveBeenCalledWith('toasts.message.exportError');
  });

  it('clears PDF loading for an empty answer so the action can be retried', async () => {
    render(<MessageActions message={{ id: 'empty', conversationType: 'ai', isComplete: true, createdAt: '2026-07-29T13:00:00Z', components: [{ type: 'text', data: { content: '' } }] } as never} isLastAiMessage={false} conversationId="conv-1" />);
    const action = screen.getByRole('button', { name: 'messageActions.exportPdf' });
    await userEvent.click(action);
    await waitFor(() => expect(notificationErrorMock).toHaveBeenCalledWith('toasts.export.failed'));
    expect(action).toBeEnabled();
    expect(screen.queryByTestId('message-pdf-export')).not.toBeInTheDocument();
    await userEvent.click(action);
    await waitFor(() => expect(notificationErrorMock).toHaveBeenCalledTimes(2));
  });

  const agentExportMessage = {
    id: 'ai-export', conversationType: 'ai', questionMessageId: 'user-1', agentIds: ['original-agent'], modelId: 'model-1', isComplete: true, isStreaming: false, createdAt: '2026-07-29T13:00:00Z',
    components: [
      { id: 'text-1', type: 'text', data: { content: 'root = Card([t,g])\nt = TextContent("Saved report [1] [2]")\ng = ImageGallery(["Web", "PDF", "Edited"], ["https://example.test/photo.png", "[1]", "generated-image:123456789012345678901234"])' } },
      { type: 'citation', data: { image_source: { reference: '1', fileName: 'chart.pdf', page: '2', externalId: 'pdf-id' } } },
      { type: 'citation', data: { image_source: { reference: '2', fileName: 'chart.pdf', page: '3', externalId: 'pdf-id' } } },
    ],
  };

  it('loads saved interaction pages before exporting an answer outside the loaded window', async () => {
    const answer = { ...agentExportMessage, conversationId: 'conv-1', components: [{ id: 'text-1', type: 'text', data: { content: 'root = Card([t])\nt = Table([Col("City"),Col("Count")], [["Tokyo",2],["Paris",10]])' } }] };
    fetchMessagesMock.mockResolvedValueOnce({ items: [], hasMore: true, nextCursor: 'older' }).mockResolvedValueOnce({ items: [{
      id: 'saved-selection', conversationId: 'conv-1', conversationType: 'user', createdAt: '2026-10-16T12:00:00Z', interaction: {
        type: 'openui', sourceMessageId: answer.id, componentId: 'text-1', formState: { __ysExplore: { 'table:t': { componentType: 'TableView', value: { query: '', sortColumn: null, direction: 'asc', selectedRows: [1] } } } },
      },
    }], hasMore: false });
    render(<MessageActions message={answer as never} isLastAiMessage={false} conversationId="conv-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'messageActions.exportAgentDocx' }));
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1), { timeout: 10000 });
    expect(fetchMessagesMock).toHaveBeenCalledWith('conv-1', { mode: 'cursor', limit: 100, cursor: 'older' });
    const request = JSON.parse(sendMessageMock.mock.calls[0][1].content);
    const markdown = JSON.stringify(JSON.parse(request.manifest).parts);
    expect(markdown).toContain('| Paris | 10 |');
    expect(markdown).not.toContain('Tokyo');
  });

  it.each([['messageActions.exportAgentDocx', 'DOCX'], ['messageActions.exportEditablePptx', 'PPTX']])('submits %s only on explicit click with exact saved sources and all citation mappings', async (action, format) => {
    document.body.innerHTML = '<div id="message-ai-export"><img src="blob:temporary-preview" /></div>';
    const message = { ...agentExportMessage, modelRequestTelemetry: { model: 'gpt-6-luna', usedTokens: 100, contextWindow: 1000 } };
    render(<MessageActions message={message as never} isLastAiMessage={false} conversationId="conv-1" />);
    expect(sendMessageMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
    const [owner, payload] = sendMessageMock.mock.calls[0];
    expect(owner).toBe('conv-1');
    expect(payload).toMatchObject({ parentMessageId: 'ai-export', agentIds: ['original-agent'], modelId: 'model-1' });
    const request = JSON.parse(payload.content);
    expect(request.format).toBe(format);
    const manifest = JSON.parse(request.manifest);
    expect(manifest.parts.filter((part: { kind: string }) => part.kind === 'image')).toEqual([
      { kind: 'image', source: 'https://example.test/photo.png', caption: 'Web', componentId: 'text-1' },
      { kind: 'image', source: '[1]', caption: 'PDF', componentId: 'text-1' },
      { kind: 'image', source: 'generated-image:123456789012345678901234', caption: 'Edited', componentId: 'text-1' },
    ]);
    expect(manifest.citations).toEqual([
      expect.objectContaining({ reference: '1', fileName: 'chart.pdf', page: '2' }),
      expect.objectContaining({ reference: '2', fileName: 'chart.pdf', page: '3' }),
    ]);
    expect(payload.content).not.toMatch(/blob:|base64|root =/);
  });

  it.each([{ isComplete: false }, { isStreaming: true }])('does not offer agent exports for an unfinished answer %o', (state) => {
    render(<MessageActions message={{ ...agentExportMessage, ...state } as never} isLastAiMessage={false} conversationId="conv-1" />);
    expect(screen.queryByRole('button', { name: 'messageActions.exportEditablePptx' })).not.toBeInTheDocument();
  });

  it('does not offer agent exports in governed mode', () => {
    conversationState.runtimeMode = 'governed';
    render(<MessageActions message={agentExportMessage as never} isLastAiMessage={false} conversationId="conv-1" />);
    expect(screen.queryByRole('button', { name: 'messageActions.exportEditablePptx' })).not.toBeInTheDocument();
  });

  it('blocks agent export while another answer is running', async () => {
    conversationState.isStreaming = true;
    render(<MessageActions message={agentExportMessage as never} isLastAiMessage={false} conversationId="conv-1" />);
    const action = screen.getByRole('button', { name: 'messageActions.exportEditablePptx' });
    expect(action).toBeDisabled();
    await userEvent.click(action);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it('cancels pending export if the active conversation changes before projection completes', async () => {
    let finish!: (value: { parts: Array<{ kind: 'markdown'; markdown: string }> }) => void;
    const spy = vi.spyOn(documentExports, 'buildMcpExportManifest').mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<MessageActions message={agentExportMessage as never} isLastAiMessage={false} conversationId="conv-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'messageActions.exportEditablePptx' }));
    conversationState.currentConversationId = 'other-conversation';
    await act(async () => finish({ parts: [{ kind: 'markdown', markdown: 'Report' }] }));
    expect(sendMessageMock).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('reports projection failures without starting an agent turn', async () => {
    const spy = vi.spyOn(documentExports, 'buildMcpExportManifest').mockRejectedValueOnce(new Error('Incomplete program'));
    render(<MessageActions message={agentExportMessage as never} isLastAiMessage={false} conversationId="conv-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'messageActions.exportEditablePptx' }));
    await waitFor(() => expect(notificationErrorMock).toHaveBeenCalledWith('toasts.export.failed'));
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'messageActions.exportEditablePptx' })).toBeEnabled();
    spy.mockRestore();
  });

  it('keeps colliding citation markers scoped to their originating text component', async () => {
    const message = { ...agentExportMessage, components: [
      { id: 'first', type: 'text', data: { content: 'root = Card([i])\ni = Image("First PDF", "[1]")' } },
      { id: 'second', type: 'text', data: { content: 'root = Card([i])\ni = Image("Second PDF", "[1]")' } },
      { type: 'citation', data: { parentId: 'first', image_source: { reference: '1', fileName: 'first.pdf', page: '2' } } },
      { type: 'citation', data: { parentId: 'second', image_source: { reference: '1', fileName: 'second.pdf', page: '3' } } },
    ] };
    render(<MessageActions message={message as never} isLastAiMessage={false} conversationId="conv-1" />);
    await userEvent.click(screen.getByRole('button', { name: 'messageActions.exportEditablePptx' }));
    await waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
    const manifest = JSON.parse(JSON.parse(sendMessageMock.mock.calls[0][1].content).manifest);
    expect(manifest.parts.filter((part: { kind: string }) => part.kind === 'image')).toEqual([
      { kind: 'image', source: '[1]', caption: 'First PDF', componentId: 'first' },
      { kind: 'image', source: '[1]', caption: 'Second PDF', componentId: 'second' },
    ]);
    expect(manifest.citations).toEqual([
      { componentId: 'first', reference: '1', fileName: 'first.pdf', page: '2' },
      { componentId: 'second', reference: '1', fileName: 'second.pdf', page: '3' },
    ]);
  });
});
