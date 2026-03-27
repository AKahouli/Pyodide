import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useConversationStore } from './store';

const fetchConversationsApiMock = vi.hoisted(() => vi.fn());
const fetchMessageApiMock = vi.hoisted(() => vi.fn());

vi.mock('./api', () => ({
  fetchConversations: fetchConversationsApiMock,
  fetchMessage: fetchMessageApiMock,
  createConversation: vi.fn(),
  updateConversation: vi.fn(),
  deleteConversation: vi.fn(),
  fetchConversation: vi.fn(),
  fetchMessages: vi.fn(),
  sendMessage: vi.fn(),
  updateFeedback: vi.fn(),
  regenerateMessage: vi.fn(),
  reportMessage: vi.fn(),
  fetchBranches: vi.fn(),
  updateMessage: vi.fn(),
  stopStream: vi.fn(),
}));

vi.mock('@/modules/models/store', () => ({
  useModelsStore: {
    getState: () => ({ refreshModels: vi.fn() }),
  },
}));

describe('conversation store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    useConversationStore.getState().clearAll();
  });

  it('fetches conversations and updates pagination state', async () => {
    fetchConversationsApiMock.mockResolvedValueOnce({
      items: [{ id: 'c1', title: 'Conversation 1' }],
      total: 1,
      page: 1,
      limit: 12,
      totalPages: 1,
    });

    await useConversationStore.getState().fetchConversations({ reset: true, limit: 12 });

    const state = useConversationStore.getState();
    expect(state.conversations).toHaveLength(1);
    expect(state.conversationsTotal).toBe(1);
    expect(state.conversationsLoading).toBe(false);
  });

  it('handles SSE connection state transitions', () => {
    useConversationStore.getState().onSSEConnected();
    expect(useConversationStore.getState().sseStatus).toBe('connected');

    useConversationStore.getState().onConnectionFailed('network issue');
    expect(useConversationStore.getState().sseStatus).toBe('failed');
    expect(useConversationStore.getState().inputDisabled).toBe(true);

    useConversationStore.getState().dismissSSEError();
    expect(useConversationStore.getState().sseError).toBeNull();
    expect(useConversationStore.getState().inputDisabled).toBe(false);
  });

  it('updates branch selection when navigating', () => {
    useConversationStore.setState({
      branchCache: new Map([
        [
          'u1',
          [
            { id: 'a1', conversationId: 'c1', conversationType: 'ai', createdAt: '' },
            { id: 'a2', conversationId: 'c1', conversationType: 'ai', createdAt: '' },
          ],
        ],
      ]),
      activeBranches: new Map([['u1', 'a1']]),
    });

    useConversationStore.getState().navigateBranch('u1', 'next');
    expect(useConversationStore.getState().activeBranches.get('u1')).toBe('a2');
  });

  it('updates title and typewriter state from name-generated event', () => {
    useConversationStore.setState({
      currentConversation: {
        id: 'c1',
        title: 'Old',
        messageCount: 0,
        lastMessageAt: '',
        isArchived: false,
        isShared: false,
        createdBy: '',
        createdAt: '',
        updatedAt: '',
      },
      conversations: [
        {
          id: 'c1',
          title: 'Old',
          messageCount: 0,
          lastMessageAt: '',
          isArchived: false,
          isShared: false,
          createdBy: '',
          createdAt: '',
          updatedAt: '',
        },
      ],
    });

    useConversationStore.getState().onConversationNameGenerated({ conversationId: 'c1', name: 'New Name' });

    const state = useConversationStore.getState();
    expect(state.currentConversation?.title).toBe('New Name');
    expect(state.typewriterConversationId).toBe('c1');
    expect(state.typewriterName).toBe('New Name');
  });
});
