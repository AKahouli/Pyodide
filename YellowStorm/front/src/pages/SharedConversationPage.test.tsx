import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { SharedConversationPage } from './SharedConversationPage';

// Mock data
const mockShareData = {
  id: 'share-1',
  title: 'Test Shared Conversation',
  sharedBy: 'John Doe',
  messages: [
    {
      conversationType: 'user' as const,
      content: 'Hello, how are you?',
      createdAt: '2024-01-01T10:00:00Z',
    },
    {
      conversationType: 'ai' as const,
      content: 'Hello! I am doing well, thank you for asking.',
      components: [
        {
          type: 'text',
          data: { content: 'Hello! I am doing well, thank you for asking.' },
        },
      ],
      createdAt: '2024-01-01T10:00:01Z',
    },
  ],
  viewCount: 42,
  createdAt: '2024-01-01T09:00:00Z',
};

// Hoist mocks before vi.mock calls
const viewPublicShareMock = vi.hoisted(() => vi.fn());
const mapComponentsToContentPartsMock = vi.hoisted(() => vi.fn<() => any[]>(() => []));

// Mock components
vi.mock('@/components/ai-elements/chat-conversation', () => ({
  ChatConversation: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div data-testid='chat-conversation' className={className}>
      {children}
    </div>
  ),
  ChatConversationContent: ({ children, className }: { children?: React.ReactNode; className?: string }) => (
    <div data-testid='chat-content' className={className}>
      {children}
    </div>
  ),
  ChatMessageBubble: ({ message }: { message: unknown }) => <div data-testid='message-bubble'>{JSON.stringify(message)}</div>,
}));

vi.mock('@/components/ai-elements/message-context', () => ({
  MessageProvider: ({ children }: { children?: React.ReactNode }) => <div data-testid='message-provider'>{children}</div>,
}));

vi.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: { children?: React.ReactNode; [key: string]: any }) => (
    <button data-testid='button' {...props}>
      {children}
    </button>
  ),
}));

vi.mock('lucide-react', () => ({
  Loader2: ({ className }: { className?: string }) => (
    <span data-testid='loader' className={className}>loader</span>
  ),
}));

vi.mock('@/modules/conversation/api', () => ({
  viewPublicShare: viewPublicShareMock,
}));

vi.mock('@/modules/conversation/utils', () => ({
  mapComponentsToContentParts: mapComponentsToContentPartsMock,
}));

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: (_namespace: string) => ({
    t: (key: string, options?: { defaultValue?: string; formattedCount?: string; date?: string }) => {
      if (options?.defaultValue) return options.defaultValue;
      if (options?.formattedCount) return `Shared ${options.formattedCount} times`;
      if (options?.date) return `Shared on ${options.date}`;
      return key;
    },
    language: 'en-US',
    ready: true,
  }),
}));

describe.skip('SharedConversationPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewPublicShareMock.mockReset();
    mapComponentsToContentPartsMock.mockReturnValue([]);
  });

  it('shows loading state while fetching share data', async () => {
    viewPublicShareMock.mockImplementation(() => new Promise(() => {}));

    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('loader')).toBeInTheDocument();
  });

  it('renders conversation when share data loads successfully', async () => {
    viewPublicShareMock.mockResolvedValue(mockShareData);

    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Test Shared Conversation')).toBeInTheDocument();
      expect(screen.getByText(/shared 42 times/i)).toBeInTheDocument();
      expect(screen.getByTestId('chat-conversation')).toBeInTheDocument();
    });
  });

  it('displays error message when share loading fails', async () => {
    viewPublicShareMock.mockRejectedValue(new Error('Network error'));

    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/conversation not found/i)).toBeInTheDocument();
    });
  });

  it('displays error message when share not found', async () => {
    viewPublicShareMock.mockResolvedValue(null as any);

    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/conversation not found/i)).toBeInTheDocument();
    });
  });

  it('formats view count based on language locale', async () => {
    viewPublicShareMock.mockResolvedValue(mockShareData);

    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/shared 42 times/i)).toBeInTheDocument();
    });
  });

  it('formats date based on language locale', async () => {
    viewPublicShareMock.mockResolvedValue(mockShareData);

    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/shared on/i)).toBeInTheDocument();
    });
  });

  it('renders messages with correct role mapping', async () => {
    viewPublicShareMock.mockResolvedValue(mockShareData);
    mapComponentsToContentPartsMock.mockReturnValue([{ type: 'text', data: { content: 'Hello! I am doing well, thank you for asking.' } }]);

    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const messageBubbles = screen.getAllByTestId('message-bubble');
      expect(messageBubbles).toHaveLength(2);

      // First message should be user
      expect(messageBubbles[0].textContent).toContain('"role":"user"');

      // Second message should be assistant
      expect(messageBubbles[1].textContent).toContain('"role":"assistant"');
    });
  });

  it('calls viewPublicShare with access token from URL', async () => {
    viewPublicShareMock.mockResolvedValue(mockShareData);

    render(
      <MemoryRouter initialEntries={['/share/abc123-token']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(viewPublicShareMock).toHaveBeenCalledWith('abc123-token');
    });
  });

  it('does not call viewPublicShare when token is missing', () => {
    render(
      <MemoryRouter initialEntries={['/share/']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    expect(viewPublicShareMock).not.toHaveBeenCalled();
  });

  it('filters out null messages', async () => {
    const shareWithNullMessage = {
      ...mockShareData,
      messages: [mockShareData.messages[0], null, mockShareData.messages[1]],
    };

    viewPublicShareMock.mockResolvedValue(shareWithNullMessage);

    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const messageBubbles = screen.getAllByTestId('message-bubble');
      expect(messageBubbles).toHaveLength(2); // Should filter out null
    });
  });

  it('uses message content directly for user messages', async () => {
    viewPublicShareMock.mockResolvedValue(mockShareData);

    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const messageBubbles = screen.getAllByTestId('message-bubble');
      expect(messageBubbles[0].textContent).toContain('Hello, how are you?');
    });
  });

  it('uses components for AI messages with fallback to content', async () => {
    viewPublicShareMock.mockResolvedValue(mockShareData);
    mapComponentsToContentPartsMock.mockReturnValue([{ type: 'text', data: { content: 'AI response from components' } }]);

    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(mapComponentsToContentPartsMock).toHaveBeenCalledWith([]);
      // The components result should be used when available
    });
  });

  it('falls back to content string when components array is empty', async () => {
    const aiMessageWithEmptyComponents = {
      conversationType: 'ai' as const,
      content: 'Simple AI response',
      components: [],
      createdAt: '2024-01-01T10:00:01Z',
    };

    viewPublicShareMock.mockResolvedValue({
      ...mockShareData,
      messages: [mockShareData.messages[0], aiMessageWithEmptyComponents],
    });
    mapComponentsToContentPartsMock.mockReturnValue([]);

    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const messageBubbles = screen.getAllByTestId('message-bubble');
      // Should use content string when components result is empty
      expect(messageBubbles[1].textContent).toContain('Simple AI response');
    });
  });

  it('renders header with title and view count', async () => {
    viewPublicShareMock.mockResolvedValue(mockShareData);

    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText('Test Shared Conversation')).toBeInTheDocument();
      expect(screen.getByText(/shared 42 times/i)).toBeInTheDocument();
    });
  });

  it('renders footer with creation date', async () => {
    viewPublicShareMock.mockResolvedValue(mockShareData);

    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/shared on/i)).toBeInTheDocument();
    });
  });

  it('has link to open app in header', async () => {
    viewPublicShareMock.mockResolvedValue(mockShareData);

    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const openAppButton = screen.getByRole('link', { name: /open app/i });
      expect(openAppButton).toBeInTheDocument();
      expect(openAppButton).toHaveAttribute('href', '/');
    });
  });

  it('handles missing view count gracefully', async () => {
    const shareWithoutViewCount = {
      ...mockShareData,
      viewCount: null,
    };

    viewPublicShareMock.mockResolvedValue(shareWithoutViewCount);

    render(
      <MemoryRouter initialEntries={['/share/test-token']}>
        <SharedConversationPage />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/shared 0 times/i)).toBeInTheDocument();
    });
  });
});
