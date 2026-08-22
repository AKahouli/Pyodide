import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { ConversationContent } from './ConversationContent';

vi.mock('@/components/ai-elements/chat-conversation', () => ({
  ChatConversation: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChatConversationContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  ChatMessageBubble: () => <div>bubble</div>,
  ChatScrollButton: () => <button type='button'>scroll</button>,
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

const storeState = {
  isStreaming: false,
  streamingComponents: [],
  streamingConversationId: null as string | null,
  awaitingConversationId: null as string | null,
  loadMoreMessages: vi.fn(),
  messagesLoading: false,
  currentConversationId: 'conv-1',
  fetchBranches: vi.fn(),
  branchCache: new Map(),
};

let isAwaitingFirstChunk = false;
let displayMessages: Message[] = [];

vi.mock('../store', () => ({
  useConversationStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
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
    displayMessages = [];
    isAwaitingFirstChunk = false;
    storeState.awaitingConversationId = null;
  });

  it('renders empty state when there are no messages', () => {
    render(<ConversationContent />);
    expect(screen.getByText('empty-state')).toBeInTheDocument();
  });

  it('shows activity before the first stream chunk arrives', () => {
    isAwaitingFirstChunk = true;
    storeState.awaitingConversationId = 'conv-1';
    render(<ConversationContent />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByTestId('conversation-activity')).toBeInTheDocument();
    isAwaitingFirstChunk = false;
    storeState.awaitingConversationId = null;
  });

  it('does not show activity while another conversation awaits its first chunk', () => {
    isAwaitingFirstChunk = true;
    storeState.awaitingConversationId = 'conv-2';
    render(<ConversationContent />);
    expect(screen.queryByText('loading-thinking')).not.toBeInTheDocument();
  });

  it('hides reliability when a completed AI message has no tool call', () => {
    displayMessages = [{
      id: 'ai-no-tool', conversationId: 'conv-1', conversationType: 'ai', createdAt: '2026-07-28T00:00:00.000Z',
      components: [
        { type: 'text', data: { content: 'Hello' } },
        { type: 'chainOfThought', data: { steps: ['Responded directly'] } },
      ],
      reliabilityEvaluation: { status: 'insufficient_evidence' },
    }];

    render(<ConversationContent />);

    expect(screen.queryByText('reliability-card')).not.toBeInTheDocument();
  });

  it('shows reliability when a completed AI message has a tool call', () => {
    displayMessages = [{
      id: 'ai-with-tool', conversationId: 'conv-1', conversationType: 'ai', createdAt: '2026-07-28T00:00:00.000Z',
      components: [
        { type: 'text', data: { content: 'Hello' } },
        { type: 'toolInfo', data: { title: 'Search' } },
      ],
      reliabilityEvaluation: { status: 'insufficient_evidence' },
    }];

    render(<ConversationContent />);

    expect(screen.getByText('reliability-card')).toBeInTheDocument();
  });

  it('shows the rerun surface for a completed text answer without a tool call', () => {
    displayMessages = [{
      id: 'ai-text-only', conversationId: 'conv-1', conversationType: 'ai', isComplete: true, createdAt: '2026-07-28T00:00:00.000Z',
      components: [{ type: 'text', data: { content: 'Hello' } }],
      reliabilityEvaluation: { status: 'insufficient_evidence' },
    }];

    render(<ConversationContent />);

    expect(screen.getByText('reliability-card')).toBeInTheDocument();
  });
});
