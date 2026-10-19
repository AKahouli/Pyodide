import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentStore } from '@/modules/agent/store';
import type { Message, MessageComponent } from '../types';
import { useConversationUiStore } from '../uiStore';
import { GroupConversationContent } from './GroupConversationContent';
import { ConversationContent } from './ConversationContent';
import type { LiveAnswer } from '../live-streams';

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
  ChatMessageBubble: ({ message, contentFooter, footerActions }: { message: { content: string }; contentFooter?: ReactNode; footerActions?: ReactNode }) => <div><div data-testid='user-bubble'>bubble<span>{message.content}</span>{contentFooter}</div>{footerActions}</div>,
  ChatScrollButton: ({ className }: { className?: string }) => <button type='button' className={className}>scroll</button>,
  ChatConversationEmptyState: () => <div>empty-state</div>,
}));

vi.mock('@/components/ai-elements/message-context', () => ({
  MessageProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('./MessageActions', () => ({ MessageActions: () => <div>message-actions</div> }));
const actionMessage = vi.hoisted(() => vi.fn());
vi.mock('./UserMessageActions', () => ({ UserMessageActions: ({ message }: { message: Message }) => { actionMessage(message); return <div>user-actions</div>; } }));
vi.mock('./EditableUserMessage', () => ({ EditableUserMessage: () => <div>editable-message</div> }));
vi.mock('./BranchNavigation', () => ({ BranchNavigation: () => <div>branch-nav</div> }));
vi.mock('./LoadingIndicator', () => ({ LoadingIndicator: ({ activity }: { activity: string }) => <div>loading-{activity}</div> }));
vi.mock('./MessageReliabilityCard', () => ({ MessageReliabilityCard: () => <div>reliability-card</div> }));
vi.mock('./MessageAttachments', () => ({ MessageAttachments: () => <div>attachments</div> }));
vi.mock('./MessageAvatar', () => ({ MessageAvatar: () => null }));
vi.mock('./ParentMessagePreview', () => ({ ParentMessagePreview: () => null }));
vi.mock('./MentionMessageJump', () => ({ MentionMessageJump: () => null }));
vi.mock('./BackgroundResultNotice', () => ({ BackgroundResultNotice: () => null }));
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
  branchCache: new Map<string, Message[]>(),
  activeBranches: new Map<string, string>(),
  messages: [] as Message[],
  liveAnswers: {} as Record<string, LiveAnswer>,
};

let isAwaitingFirstChunk = false;
vi.mock('@/modules/auth/useAuth', () => ({ useAuth: () => ({ user: { id: 'owner' } }) }));
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
  useBranchCache: () => storeState.branchCache,
  useActiveBranches: () => storeState.activeBranches,
  useEditingMessageId: () => null,
}));

describe('ConversationContent', () => {
  it('shows readable artifact tags inside sent user bubbles after remount while preserving raw action payloads', () => {
    const ref = btoa(JSON.stringify(['document', 'workspace', 'document'])).replace(/=/g, '');
    const content = `Summarize the report.\n\nUse this conversation asset: Report [Q1].pdf [${ref}]`;
    const message = { id: 'user-assets', conversationId: 'conv-1', conversationType: 'user', content, createdAt: '2026-01-01T00:00:00Z' } as Message;
    displayMessages = [message]; storeState.messages = [message];
    const mounted = render(<ConversationContent />);
    expect(screen.getByText('Summarize the report.')).toBeInTheDocument();
    const chip = screen.getByText('Report [Q1].pdf');
    expect(screen.getByTestId('user-bubble')).toContainElement(chip);
    expect(document.body.textContent).not.toContain(ref);
    expect(document.body.innerHTML).not.toContain(ref);
    expect(actionMessage).toHaveBeenCalledWith(message);
    expect(message.content).toBe(content);
    mounted.unmount(); render(<ConversationContent />);
    expect(screen.getByText('Report [Q1].pdf')).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(ref);
  });

  it.each(['owner', 'other-member'])('shows historical asset tags for %s in group conversations without changing source text', senderId => {
    const ref = btoa(JSON.stringify(['artifact', 'message', 'output'])).replace(/=/g, '');
    const content = `Utiliser ce contenu de la conversation : Résumé.docx [${ref}]`;
    const message = { id: 'group-user', conversationId: 'conv-1', conversationType: 'user', senderId, content, createdAt: '2026-01-01T00:00:00Z' } as Message;
    displayMessages = [message]; storeState.messages = [message];
    render(<GroupConversationContent />);
    expect(screen.getByTestId('user-bubble')).toContainElement(screen.getByText('Résumé.docx'));
    expect(document.body.innerHTML).not.toContain(ref);
    expect(message.content).toBe(content);
  });
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
    storeState.branchCache = new Map();
    storeState.activeBranches = new Map();
    storeState.liveAnswers = {};
    storeState.currentConversationId = 'conv-1';
    useConversationUiStore.setState({ autoReliabilityEnabled: false });
    // Shared Zustand agent directory — reset so parallel bubble/identity suites cannot
    // leave a stale directory that blanks the answer-producer header.
    useAgentStore.setState({ agents: [], isInitialized: true, isLoading: false, error: null });
  });

  it.each(['live-answer', 'fallback'])('preserves reading preferences through the %s handoff and resets them across conversations', (mode) => {
    vi.useFakeTimers();
    try {
      const components: LiveAnswer['components'] = [{ id: 'summary', type: 'agentActivity', data: {
        activityKind: 'reasoning_summary', summary: 'Inspect the supplied evidence carefully', status: 'completed',
      } }];
      displayMessages = [{ id: 'question', conversationId: 'conv-1', conversationType: 'user', content: 'Check this evidence', createdAt: '2026-10-17T09:59:00Z' }];
      storeState.streamingComponents = components;
      storeState.liveAnswers = mode === 'fallback' ? {} : { answer: { conversationId: 'conv-1', messageId: 'answer', components, createdAt: '2026-10-17T10:00:00Z', revision: 1 } };
      storeState.isStreaming = true;
      storeState.streamingMessageId = 'answer';
      storeState.streamingConversationId = 'conv-1';
      const { container, rerender } = render(<ConversationContent />);
      const pane = container.querySelector('[data-activity-pane]') as HTMLElement;
      Object.defineProperties(pane, { scrollHeight: { value: 800 }, clientHeight: { value: 200 } });
      pane.scrollTop = 120;
      fireEvent.scroll(pane);
      storeState.liveAnswers = {};
      storeState.isStreaming = false;
      storeState.streamingConversationId = null;
      displayMessages = [{ id: 'answer', conversationId: 'conv-1', conversationType: 'ai', createdAt: '2026-10-17T10:00:00Z', components }];
      rerender(<ConversationContent />);
      act(() => { vi.advanceTimersByTime(3_000); });
      expect(container.querySelector('[data-activity-pane-shell]')).not.toHaveAttribute('data-collapsed');
      expect((container.querySelector('[data-activity-pane]') as HTMLElement).scrollTop).toBe(120);

      storeState.currentConversationId = 'conv-2';
      displayMessages = [{ ...displayMessages[0], id: 'another-answer', conversationId: 'conv-2' }];
      rerender(<ConversationContent />);
      expect(container.querySelector('[data-activity-pane-shell]')).toHaveAttribute('data-collapsed');
    } finally { vi.useRealTimers(); }
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

  it('keeps saved answer history visible while an unrelated new turn streams', () => {
    const old = { id: 'old-answer', questionMessageId: 'old-question', conversationId: 'conv-1', conversationType: 'ai', isComplete: true, createdAt: '2026-07-28T00:00:00.000Z', components: [{ type: 'text', data: { content: 'Saved' } }] } as Message;
    displayMessages = [old];
    storeState.branchCache.set('old-question', [old, { ...old, id: 'old-version' }]);
    storeState.activeBranches.set('old-question', old.id);
    storeState.isStreaming = true;
    storeState.streamingConversationId = 'conv-1';
    storeState.streamingMessageId = 'new-answer';
    render(<ConversationContent />);
    expect(screen.getByText('branch-nav')).toBeInTheDocument();
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
      components: [
        { id: 'activity-complete', type: 'agentActivity', data: { summary: '', status: 'completed', actorId: 'agent-complete', actorName: 'Completed Agent' } },
        { id: 'tool-complete', type: 'toolActivity', data: { toolName: 'run_code', summary: 'Completed work', renderKind: 'run_code', status: 'completed', actorId: 'agent-complete', actorName: 'Completed Agent' } },
      ],
    }];
    storeState.isStreaming = true;
    storeState.streamingConversationId = 'conv-1';
    storeState.streamingMessageId = 'ai-live';
    storeState.streamingComponents = [
      { id: 'activity-live', type: 'agentActivity', data: { summary: '', status: 'running', actorId: 'agent-live', actorName: 'Live Agent' } },
      { id: 'tool-live', type: 'toolActivity', data: { toolName: 'run_code', summary: 'Current work', renderKind: 'run_code', status: 'running', actorId: 'agent-live', actorName: 'Live Agent' } },
    ];

    const { container } = render(<ConversationContent />);

    expect(screen.getAllByText('Completed Agent')).not.toHaveLength(0);
    expect(screen.getAllByText('Live Agent')).not.toHaveLength(0);
    expect(container.querySelectorAll('[data-agent-activity][data-active="true"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-agent-scan]')).toHaveLength(2);
  });

  it('shows the thinking label in the live bubble while the ADK placeholder awaits output', () => {
    storeState.isStreaming = true;
    storeState.streamingConversationId = 'conv-1';
    storeState.streamingMessageId = 'ai-live';
    storeState.streamingComponents = [
      { id: 'activity-live', type: 'agentActivity', data: { summary: '', status: 'completed', actorId: 'agent-live', actorName: 'Smart Agent' } },
    ];

    const { container } = render(<ConversationContent />);

    // The test i18n layer renders keys, so assert the key chosen by the real parent path.
    expect(container).toHaveTextContent('stream.activity.thinking');
    expect(container).not.toHaveTextContent('stream.activity.agentPlanning');
  });

  it('does not show the thinking counter for a completed persisted message', () => {
    displayMessages = [{
      id: 'ai-done', conversationId: 'conv-1', conversationType: 'ai', isComplete: true, createdAt: '2026-07-28T00:00:00.000Z',
      components: [
        { id: 'activity-done', type: 'agentActivity', data: { summary: '', status: 'completed', actorId: 'agent-done', actorName: 'Smart Agent' } },
        { type: 'text', data: { content: 'Hello' } },
      ],
    }];

    const { container } = render(<ConversationContent />);

    expect(container).toHaveTextContent('stream.activity.agentPrepared');
    expect(container).not.toHaveTextContent('stream.activity.thinking');
  });
});
