import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GroupConversationPage } from './GroupConversationPage';
import type { Conversation } from './types';

const authState = vi.hoisted(() => ({
  user: { id: 'owner-1' } as { id: string } | null,
  isLoading: false,
}));
const fetchMessages = vi.hoisted(() => vi.fn());
const setCurrentConversation = vi.hoisted(() => vi.fn());
const fetchConversations = vi.hoisted(() => vi.fn());
const joinConversation = vi.hoisted(() => vi.fn());

vi.mock('@/modules/auth', () => ({ useAuth: () => authState }));
vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('./store', () => ({
  useConversationStore: (selector: (state: Record<string, unknown>) => unknown) =>
    selector({ setCurrentConversation, fetchConversations, fetchMessages }),
}));
vi.mock('./api', () => ({ joinConversation }));
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock('./components/ConversationHeader', () => ({ ConversationHeader: () => null }));
vi.mock('./components/GroupConversationContent', () => ({ GroupConversationContent: () => null }));
vi.mock('./components/ConversationInput', () => ({ ConversationInput: () => null }));
vi.mock('./components/StreamErrorDialog', () => ({ StreamErrorDialog: () => null }));
vi.mock('@/modules/file-viewer', () => ({ FileViewerSidebar: () => null }));
vi.mock('./components/JoinConversationLanding', () => ({
  JoinConversationLanding: () => <div>join-landing</div>,
}));

function sharedConversation(patch: Partial<Conversation> = {}): Conversation {
  return {
    id: 'conv-1',
    title: 'Shared conversation',
    createdBy: 'owner-1',
    isShared: true,
    messageCount: 0,
    lastMessageAt: '2026-01-01T00:00:00Z',
    isArchived: false,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    groupMeta: {
      isGroup: true,
      members: [
        { userId: 'recipient-1', status: 'member', joinedAt: '2026-01-01T00:00:00Z', mentions: [] },
      ],
      invitedUsers: [],
    },
    ...patch,
  } as Conversation;
}

describe('GroupConversationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.user = { id: 'owner-1' };
    authState.isLoading = false;
  });

  it('lets the creator open a shared conversation without the invite landing', async () => {
    render(
      <MemoryRouter>
        <GroupConversationPage id='conv-1' conversation={sharedConversation()} />
      </MemoryRouter>,
    );

    expect(screen.queryByText('join-landing')).not.toBeInTheDocument();
    await waitFor(() => expect(fetchMessages).toHaveBeenCalledWith('conv-1'));
  });

  it('shows the invite landing to a user without membership', () => {
    authState.user = { id: 'stranger-1' };
    render(
      <MemoryRouter>
        <GroupConversationPage id='conv-1' conversation={sharedConversation()} />
      </MemoryRouter>,
    );

    expect(screen.getByText('join-landing')).toBeInTheDocument();
    expect(fetchMessages).not.toHaveBeenCalled();
  });
});
