import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { LocalizationProvider } from '@/modules/localization';
import { ChatMessageThread } from './ChatMessageThread';
import { useWorkyMessages, useWorkyStore } from '../store';

vi.mock('./ChatClarificationCard', () => ({
  ChatClarificationCard: ({
    clarification,
  }: {
    clarification: { id: string; question: string };
  }) => <li data-testid='worky-chat-clarification'>{clarification.question}</li>,
}));

vi.mock('../store', () => ({
  useWorkyMessages: vi.fn(),
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

    render(
      <TestProviders>
        <ChatMessageThread />
      </TestProviders>,
    );
    // The i18n instance is uninitialized in tests so the message
    // surfaces as the raw translation key — match by key path.
    expect(screen.getByText('messages.empty')).toBeInTheDocument();
  });

  it('renders each persisted message as an owner/manager conversation bubble', () => {
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

    render(
      <TestProviders>
        <ChatMessageThread />
      </TestProviders>,
    );

    // Now rendered via the shared conversation ChatMessageBubble (owner→user
    // bubble on the right, manager→assistant on the left) — role is exposed via
    // the preserved test ids, not an inline role label.
    expect(screen.getByTestId('worky-message-list')).toBeInTheDocument();
    expect(screen.getByTestId('worky-message-owner')).toBeInTheDocument();
    expect(screen.getByTestId('worky-message-manager')).toBeInTheDocument();
    expect(screen.getByText('Hello Manager')).toBeInTheDocument();
    expect(screen.getByText('Here is the plan')).toBeInTheDocument();
  });

  it('renders the manager reply in full from persisted messages once message.appended arrives, with no partial-token streaming bubble', () => {
    mockedUseMessages.mockReturnValue([
      {
        id: 'm1',
        role: 'owner',
        content: 'go on',
        planDeltaRef: null,
        createdAt: '2026-06-21T10:30:00.000Z',
      },
      {
        id: 'm2',
        role: 'manager',
        content: 'Here is the complete reply, delivered as one row.',
        planDeltaRef: null,
        createdAt: '2026-06-21T10:30:05.000Z',
      },
    ]);
    // `streaming` may still be true here (e.g. set optimistically by the
    // composer) — it must not resurrect a partial-token bubble now that
    // manager replies arrive as complete `message.appended` rows.
    mockedUseStore.mockImplementation(
      (selector: (s: { streaming: boolean; pendingClarifications: [] }) => unknown) =>
        selector({ streaming: true, pendingClarifications: [] }),
    );

    render(
      <TestProviders>
        <ChatMessageThread />
      </TestProviders>,
    );

    expect(screen.getByTestId('worky-message-manager')).toBeInTheDocument();
    expect(
      screen.getByText('Here is the complete reply, delivered as one row.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('worky-message-streaming')).not.toBeInTheDocument();
  });

  it('renders manager components when present, not the plain content fallback', () => {
    mockedUseMessages.mockReturnValue([
      {
        id: 'm1',
        role: 'manager',
        content: 'plain fallback',
        planDeltaRef: null,
        createdAt: '2026-08-13T10:00:00.000Z',
        components: [{ id: 'c1', type: 'text', data: { content: 'rich component text' } }],
      },
    ]);

    render(
      <TestProviders>
        <ChatMessageThread />
      </TestProviders>,
    );

    expect(screen.getByText('rich component text')).toBeInTheDocument();
    expect(screen.queryByText('plain fallback')).not.toBeInTheDocument();
  });

  it('falls back to plain content when a manager message has no components', () => {
    mockedUseMessages.mockReturnValue([
      {
        id: 'm2',
        role: 'manager',
        content: 'just text',
        planDeltaRef: null,
        createdAt: '2026-08-13T10:00:00.000Z',
      },
    ]);

    render(
      <TestProviders>
        <ChatMessageThread />
      </TestProviders>,
    );

    expect(screen.getByText('just text')).toBeInTheDocument();
  });

  it('renders persisted manager Markdown including tables', () => {
    mockedUseMessages.mockReturnValue([
      {
        id: 'm3',
        role: 'manager',
        content: '| Agent | Status |\n| --- | --- |\n| Researcher | Done |',
        planDeltaRef: null,
        createdAt: '2026-08-13T10:00:00.000Z',
      },
    ]);

    render(
      <TestProviders>
        <ChatMessageThread />
      </TestProviders>,
    );

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Agent' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Researcher' })).toBeInTheDocument();
  });

  it('renders fenced manager code as a formatted code block', () => {
    mockedUseMessages.mockReturnValue([
      {
        id: 'm-code',
        role: 'manager',
        content: '```ts\nconst status = "done";\n```',
        planDeltaRef: null,
        createdAt: '2026-08-13T10:00:00.000Z',
      },
    ]);

    render(
      <TestProviders>
        <ChatMessageThread />
      </TestProviders>,
    );

    expect(screen.getByText('const status = "done";').closest('pre')).not.toBeNull();
  });

  it('uses the shared assistant activity presentation for manager components', () => {
    mockedUseMessages.mockReturnValue([
      {
        id: 'm4',
        role: 'manager',
        content: '',
        planDeltaRef: null,
        createdAt: '2026-08-13T10:00:00.000Z',
        components: [
          { id: 'tool-1', type: 'toolActivity', data: { summary: 'Researching prospects', status: 'completed' } },
          { id: 'text-1', type: 'text', data: { content: 'Research complete.' } },
        ],
      },
    ]);

    render(
      <TestProviders>
        <ChatMessageThread />
      </TestProviders>,
    );

    expect(screen.getByText('Researching prospects')).toBeInTheDocument();
    expect(screen.getByText('Research complete.')).toBeInTheDocument();
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
