import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
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

vi.mock('../store', () => ({
  useConversationStore: (selector: (state: typeof storeState) => unknown) => selector(storeState),
  useDisplayMessages: () => [],
  useIsAwaitingFirstChunk: () => isAwaitingFirstChunk,
  useAwaitingConversationId: () => storeState.awaitingConversationId,
  useMessagesHasMore: () => false,
  useMessagesLoadingOlder: () => false,
  useBranchCache: () => new Map(),
  useActiveBranches: () => new Map(),
  useEditingMessageId: () => null,
}));

describe('ConversationContent', () => {
  it('renders empty state when there are no messages', () => {
    render(<ConversationContent />);
    expect(screen.getByText('empty-state')).toBeInTheDocument();
  });

  it('shows activity before the first stream chunk arrives', () => {
    isAwaitingFirstChunk = true;
    storeState.awaitingConversationId = 'conv-1';
    render(<ConversationContent />);
    expect(screen.getByText('loading-thinking')).toBeInTheDocument();
    isAwaitingFirstChunk = false;
    storeState.awaitingConversationId = null;
  });

  it('does not show activity while another conversation awaits its first chunk', () => {
    isAwaitingFirstChunk = true;
    storeState.awaitingConversationId = 'conv-2';
    render(<ConversationContent />);
    expect(screen.queryByText('loading-thinking')).not.toBeInTheDocument();
    isAwaitingFirstChunk = false;
    storeState.awaitingConversationId = null;
  });
});
