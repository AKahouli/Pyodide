import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, MessageComponent } from '../types';
import { useConversationUiStore } from '../uiStore';
import { ConversationContent } from './ConversationContent';

const rerunReliabilityEvaluationMock = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({
  rerunReliabilityEvaluation: rerunReliabilityEvaluationMock,
  fetchToolResult: vi.fn().mockResolvedValue({ resultJson: null }),
  getArtifactDownloadUrl: vi.fn().mockResolvedValue({ url: '' }),
  fetchConversationSettings: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/components/ai-elements/chat-conversation', () => ({
  ChatConversation: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChatConversationContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChatConversationFollow: ({ active }: { active: boolean }) => <div data-testid='conversation-follow' data-active={active} />,
  ChatMessageBubble: ({ footerActions }: { footerActions?: ReactNode }) => <div>bubble{footerActions}</div>,
  ChatScrollButton: ({ className }: { className?: string }) => <button type='button' className={className}>scroll</button>,
  ChatConversationEmptyState: () => <div>empty-state</div>,
}));

vi.mock('@/components/ai-elements/message-context', () => ({
  MessageProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./MessageActions', () => ({ MessageActions: () => <div>message-actions</div> }));
vi.mock('./UserMessageActions', () => ({ UserMessageActions: () => <div>user-actions</div> }));
vi.mock('./EditableUserMessage', () => ({ EditableUserMessage: () => <div>editable-message</div> }));
vi.mock('./BranchNavigation', () => ({ BranchNavigation: () => <div>branch-nav</div> }));
vi.mock('./LoadingIndicator', () => ({ LoadingIndicator: ({ activity }: { activity: string }) => <div>loading-{activity}</div> }));
vi.mock('./MessageReliabilityCard', () => ({ MessageReliabilityCard: () => <div>reliability-card</div> }));
vi.mock('./MessageAttachments', () => ({ MessageAttachments: () => <div>attachments</div> }));
vi.mock('./outline/OutlineAnchorScroller', () => ({ OutlineAnchorScroller: () => null }));

const storeState = {
  isStreaming: false,
  streamingComponents: [] as MessageComponent[],
  streamingConversationId: null as string | null,
  streamingMessageId: null as string | null,
  awaitingConversationId: null as string | null,
  sendMessage: vi.fn(),
  loadMoreMessages: vi.fn(),
  messagesLoading: false,
  currentConversationId: 'conv-1',
  fetchBranches: vi.fn(),
  branchCache: new Map(),
  messages: [] as Message[],
};

let isAwaitingFirstChunk = false;
let displayMessages: Message[] = [];

vi.mock('../store', () => ({
  useConversationStore: Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    { getState: () => storeState },
  ),
  useDisplayMessages: () => displayMessages,
  useIsAwaitingFirstChunk: () => isAwaitingFirstChunk,
  useAwaitingConversationId: () => storeState.awaitingConversationId,
  useMessagesHasMore: () => false,
  useMessagesLoadingOlder: () => false,
  useBranchCache: () => new Map(),
  useActiveBranches: () => new Map(),
  useEditingMessageId: () => null,
}));

describe('ConversationContent', () => {
  beforeEach(() => {
    vi.useRealTimers();
    displayMessages = [];
    isAwaitingFirstChunk = false;
    storeState.isStreaming = false;
    storeState.streamingComponents = [];
    storeState.streamingConversationId = null;
    storeState.streamingMessageId = null;
    storeState.awaitingConversationId = null;
    storeState.messages = [];
    useConversationUiStore.setState({ autoReliabilityEnabled: false });
  });

  it('renders empty state when there are no messages', () => {
    render(<ConversationContent />);
    expect(screen.getByText('empty-state')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'scroll' })).toHaveClass('right-3', 'left-auto', 'translate-x-0');
  });

  it('shows activity before the first stream chunk arrives', () => {
    isAwaitingFirstChunk = true;
    storeState.awaitingConversationId = 'conv-1';
    render(<ConversationContent />);
    expect(screen.getAllByRole('status')).not.toHaveLength(0);
    expect(screen.getByTestId('conversation-assistant-bubble')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-follow')).toHaveAttribute('data-active', 'true');
    isAwaitingFirstChunk = false;
    storeState.awaitingConversationId = null;
  });

  it('does not show activity while another conversation awaits its first chunk', () => {
    isAwaitingFirstChunk = true;
    storeState.awaitingConversationId = 'conv-2';
    render(<ConversationContent />);
    expect(screen.queryByText('loading-thinking')).not.toBeInTheDocument();
    expect(screen.getByTestId('conversation-follow')).toHaveAttribute('data-active', 'false');
  });

  it('hides reliability when a completed AI message has no tool call', () => {
    displayMessages = [{
      id: 'ai-no-tool', conversationId: 'conv-1', conversationType: 'ai', createdAt: '2026-07-28T00:00:00.000Z',
      components: [
        { type: 'text', data: { content: 'Hello' } },
      ],
      reliabilityEvaluation: { status: 'insufficient_evidence' },
    }];

    render(<ConversationContent />);

    expect(screen.queryByText('reliability-card')).not.toBeInTheDocument();
  });

  it('hides the reliability pane while auto reliability evaluation is disabled', () => {
    displayMessages = [{
      id: 'ai-with-tool-off', conversationId: 'conv-1', conversationType: 'ai', createdAt: '2026-07-28T00:00:00.000Z',
      components: [
        { type: 'text', data: { content: 'Hello' } },
        { type: 'toolActivity', data: { title: 'Search' } },
      ],
      reliabilityEvaluation: { status: 'insufficient_evidence' },
    }];

    render(<ConversationContent />);

    expect(screen.queryByText('reliability-card')).not.toBeInTheDocument();
  });

  it('shows reliability when a completed AI message has a tool call', () => {
    useConversationUiStore.setState({ autoReliabilityEnabled: true });
    displayMessages = [{
      id: 'ai-with-tool', conversationId: 'conv-1', conversationType: 'ai', createdAt: '2026-07-28T00:00:00.000Z',
      components: [
        { type: 'text', data: { content: 'Hello' } },
        { type: 'toolActivity', data: { title: 'Search' } },
      ],
      reliabilityEvaluation: { status: 'insufficient_evidence' },
    }];

    render(<ConversationContent />);

    expect(screen.getByText('reliability-card')).toBeInTheDocument();
  });

  it('places user actions in the message metadata footer', () => {
    displayMessages = [{
      id: 'user-1', conversationId: 'conv-1', conversationType: 'user', content: 'Question', createdAt: '2026-07-28T00:00:00.000Z',
    }];

    render(<ConversationContent />);

    expect(screen.getByText('user-actions')).toBeInTheDocument();
  });

  it('shows the rerun surface for a completed text answer without a tool call', () => {
    useConversationUiStore.setState({ autoReliabilityEnabled: true });
    displayMessages = [{
      id: 'ai-text-only', conversationId: 'conv-1', conversationType: 'ai', isComplete: true, createdAt: '2026-07-28T00:00:00.000Z',
      components: [{ type: 'text', data: { content: 'Hello' } }],
      reliabilityEvaluation: { status: 'insufficient_evidence' },
    }];

    render(<ConversationContent />);

    expect(screen.getByText('reliability-card')).toBeInTheDocument();
  });

  it('auto-queues reliability evaluation when a streamed answer completes with the toggle on', async () => {
    vi.useRealTimers();
    rerunReliabilityEvaluationMock.mockClear();
    vi.useFakeTimers();
    useConversationUiStore.setState({ autoReliabilityEnabled: true });
    displayMessages = [{
      id: 'ai-auto', conversationId: 'conv-1', conversationType: 'ai', isComplete: true, createdAt: '2026-07-28T00:00:00.000Z',
      components: [{ type: 'text', data: { content: 'Hello' } }],
    }];
    storeState.messages = displayMessages;

    const { rerender } = render(<ConversationContent />);

    // Stream starts, then completes — mirroring the real streaming lifecycle.
    storeState.isStreaming = true;
    storeState.streamingConversationId = 'conv-1';
    storeState.streamingMessageId = 'ai-auto';
    await act(async () => {
      rerender(<ConversationContent />);
    });
    storeState.isStreaming = false;
    storeState.streamingMessageId = null;
    await act(async () => {
      rerender(<ConversationContent />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(rerunReliabilityEvaluationMock).toHaveBeenCalledWith('conv-1', 'ai-auto');
  });

  it('does not auto-queue reliability evaluation when an evaluation already exists', async () => {
    vi.useRealTimers();
    rerunReliabilityEvaluationMock.mockClear();
    vi.useFakeTimers();
    useConversationUiStore.setState({ autoReliabilityEnabled: true });
    displayMessages = [{
      id: 'ai-auto', conversationId: 'conv-1', conversationType: 'ai', isComplete: true, createdAt: '2026-07-28T00:00:00.000Z',
      components: [{ type: 'text', data: { content: 'Hello' } }],
      reliabilityEvaluation: { status: 'completed', score: 88 },
    }];
    storeState.messages = displayMessages;

    const { rerender } = render(<ConversationContent />);

    // Stream starts, then completes — mirroring the real streaming lifecycle.
    storeState.isStreaming = true;
    storeState.streamingConversationId = 'conv-1';
    storeState.streamingMessageId = 'ai-auto';
    await act(async () => {
      rerender(<ConversationContent />);
    });
    storeState.isStreaming = false;
    storeState.streamingMessageId = null;
    await act(async () => {
      rerender(<ConversationContent />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });

    expect(rerunReliabilityEvaluationMock).not.toHaveBeenCalled();
  });

  it('animates only the dedicated live assistant bubble', () => {
    displayMessages = [{
      id: 'ai-complete', conversationId: 'conv-1', conversationType: 'ai', isComplete: true, createdAt: '2026-07-28T00:00:00.000Z',
      components: [{ id: 'tool-complete', type: 'toolActivity', data: { toolName: 'run_code', summary: 'Completed work', renderKind: 'run_code', status: 'completed', actorName: 'Completed Agent' } }],
    }];
    storeState.isStreaming = true;
    storeState.streamingConversationId = 'conv-1';
    storeState.streamingMessageId = 'ai-live';
    storeState.streamingComponents = [{ id: 'tool-live', type: 'toolActivity', data: { toolName: 'run_code', summary: 'Current work', renderKind: 'run_code', status: 'running', actorName: 'Live Agent' } }];

    const { container } = render(<ConversationContent />);

    expect(screen.getAllByText('Completed Agent')).not.toHaveLength(0);
    expect(screen.getAllByText('Live Agent')).not.toHaveLength(0);
    expect(container.querySelectorAll('[data-agent-activity][data-active="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-agent-scan]')).toHaveLength(2);
  });
});
