import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { LocalizationProvider } from '@/modules/localization';
import { ChatMessageThread } from './ChatMessageThread';
import { useWorkyMessages, useWorkyAssistantText, useWorkyStore } from '../store';

vi.mock('./ChatClarificationCard', () => ({
  ChatClarificationCard: ({
    clarification,
  }: {
    clarification: { id: string; question: string };
  }) => <li data-testid='worky-chat-clarification'>{clarification.question}</li>,
}));

vi.mock('../store', () => ({
  useWorkyMessages: vi.fn(),
  useWorkyAssistantText: vi.fn(),
  useWorkyStore: vi.fn(),
}));

vi.mock('../query/hooks', () => ({
  useRespondInteraction: vi.fn(() => ({
    mutate: vi.fn(),
    isPending: false,
  })),
}));

function TestProviders({ children }: { children: ReactNode }): JSX.Element {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return (
    <QueryClientProvider client={qc}>
      <LocalizationProvider>{children}</LocalizationProvider>
    </QueryClientProvider>
  );
}

const mockedUseMessages = useWorkyMessages as unknown as ReturnType<typeof vi.fn>;
const mockedUseAssistantText = useWorkyAssistantText as unknown as ReturnType<typeof vi.fn>;
const mockedUseStore = useWorkyStore as unknown as ReturnType<typeof vi.fn>;

describe('ChatMessageThread', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseStore.mockImplementation(
      (selector: (s: { streaming: boolean; pendingClarifications: [] }) => unknown) =>
        selector({ streaming: false, pendingClarifications: [] }),
    );
  });

  it('renders the empty state when no messages are present', () => {
    mockedUseMessages.mockReturnValue([]);
    mockedUseAssistantText.mockReturnValue('');

    render(
      <TestProviders>
        <ChatMessageThread />
      </TestProviders>,
    );
    // The i18n instance is uninitialized in tests so the message
    // surfaces as the raw translation key — match by key path.
    expect(screen.getByText('messages.empty')).toBeInTheDocument();
  });

  it('renders each persisted message as a bullet list item with role label and timestamp', () => {
    mockedUseMessages.mockReturnValue([
      {
        id: 'm1',
        role: 'owner',
        content: 'Hello Manager',
        planDeltaRef: null,
        createdAt: '2026-06-21T10:30:00.000Z',
      },
      {
        id: 'm2',
        role: 'manager',
        content: 'Here is the plan',
        planDeltaRef: null,
        createdAt: '2026-06-21T10:31:00.000Z',
      },
    ]);
    mockedUseAssistantText.mockReturnValue('');

    render(
      <TestProviders>
        <ChatMessageThread />
      </TestProviders>,
    );

    const list = screen.getByTestId('worky-message-list');
    expect(list.tagName).toBe('UL');
    expect(screen.getByTestId('worky-message-owner')).toBeInTheDocument();
    expect(screen.getByTestId('worky-message-manager')).toBeInTheDocument();
    expect(screen.getByText('Hello Manager')).toBeInTheDocument();
    expect(screen.getByText('Here is the plan')).toBeInTheDocument();
    // Both messages should expose a localized role label (raw key in
    // test environment — the component renders `messages.role.owner` /
    // `messages.role.manager` which the i18n init resolves to the
    // translation in production).
    expect(screen.getByText('messages.role.owner')).toBeInTheDocument();
    expect(screen.getByText('messages.role.manager')).toBeInTheDocument();
    // Timestamps formatted by date-fns HH:mm
    expect(screen.getByText('12:30')).toBeInTheDocument();
    expect(screen.getByText('12:31')).toBeInTheDocument();
  });

  it('appends a streaming bullet at the end of the list when the manager is mid-turn', () => {
    mockedUseMessages.mockReturnValue([
      {
        id: 'm1',
        role: 'owner',
        content: 'go on',
        planDeltaRef: null,
        createdAt: '2026-06-21T10:30:00.000Z',
      },
    ]);
    mockedUseAssistantText.mockReturnValue('Drafting the next step…');
    mockedUseStore.mockImplementation(
      (selector: (s: { streaming: boolean; pendingClarifications: [] }) => unknown) =>
        selector({ streaming: true, pendingClarifications: [] }),
    );

    render(
      <TestProviders>
        <ChatMessageThread />
      </TestProviders>,
    );

    expect(screen.getByTestId('worky-message-streaming')).toBeInTheDocument();
    expect(screen.getByText('Drafting the next step…')).toBeInTheDocument();
  });

  it('renders clarifications inline after the owner message that triggered them', () => {
    mockedUseMessages.mockReturnValue([
      {
        id: 'm1',
        role: 'owner',
        content: 'hello',
        planDeltaRef: null,
        createdAt: '2026-06-21T10:00:00.000Z',
      },
      {
        id: 'm2',
        role: 'owner',
        content: 'second question',
        planDeltaRef: null,
        createdAt: '2026-06-21T10:05:00.000Z',
      },
    ]);
    mockedUseAssistantText.mockReturnValue('');
    const pendingClarifications = [
      {
        id: 'c1',
        type: 'clarification',
        question: 'First clarification',
        options: [],
        taskId: null,
        blocksTaskIds: [],
        createdAt: '2026-06-21T10:01:00.000Z',
      },
      {
        id: 'c2',
        type: 'clarification',
        question: 'Second clarification',
        options: [],
        taskId: null,
        blocksTaskIds: [],
        createdAt: '2026-06-21T10:06:00.000Z',
      },
    ];
    mockedUseStore.mockImplementation(
      (
        selector: (s: {
          streaming: boolean;
          pendingClarifications: typeof pendingClarifications;
        }) => unknown,
      ) =>
        selector({
          streaming: false,
          pendingClarifications,
        }),
    );

    render(
      <TestProviders>
        <ChatMessageThread streamId='stream-1' />
      </TestProviders>,
    );

    const list = screen.getByTestId('worky-message-list');
    const items = Array.from(list.children).map((node) => node.textContent ?? '');
    expect(items[0]).toContain('hello');
    expect(items[1]).toContain('First clarification');
    expect(items[2]).toContain('second question');
    expect(items[3]).toContain('Second clarification');
  });
});
