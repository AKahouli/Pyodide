import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatConversationEmptyState, ChatConversationFollow, ChatMessageBubble } from './chat-conversation';

const stickToBottomMocks = vi.hoisted(() => ({
  scrollElement: null as HTMLElement | null,
  scrollToBottom: vi.fn(),
  stopScroll: vi.fn(),
}));

vi.mock('use-stick-to-bottom', () => {
  const StickToBottom = Object.assign(
    ({ children }: { children: ReactNode }) => <div>{children}</div>,
    { Content: ({ children }: { children: ReactNode }) => <div>{children}</div> },
  );
  return {
    StickToBottom,
    useStickToBottomContext: () => ({
      scrollRef: { current: stickToBottomMocks.scrollElement },
      scrollToBottom: stickToBottomMocks.scrollToBottom,
      stopScroll: stickToBottomMocks.stopScroll,
      isAtBottom: true,
    }),
  };
});

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    language: 'fr',
    t: (key: string) => ({
      'message.edited': 'Modifié',
      'message.empty.title': 'Démarrer une conversation',
      'message.empty.description': 'Envoyez un message pour commencer à échanger avec l’IA',
    }[key] || key),
  }),
}));

describe('ChatConversationFollow', () => {
  beforeEach(() => {
    stickToBottomMocks.scrollElement = document.createElement('div');
    stickToBottomMocks.scrollToBottom.mockReset();
    stickToBottomMocks.stopScroll.mockReset();
  });

  it('starts following for each stream and stops after manual scrolling', () => {
    const { rerender } = render(<ChatConversationFollow active={false} />);

    rerender(<ChatConversationFollow active />);
    expect(stickToBottomMocks.scrollToBottom).toHaveBeenCalledOnce();
    expect(stickToBottomMocks.scrollToBottom).toHaveBeenCalledWith('instant');

    act(() => stickToBottomMocks.scrollElement!.dispatchEvent(new WheelEvent('wheel')));
    expect(stickToBottomMocks.stopScroll).toHaveBeenCalled();
    const wheelStopCalls = stickToBottomMocks.stopScroll.mock.calls.length;
    act(() => stickToBottomMocks.scrollElement!.dispatchEvent(new TouchEvent('touchmove')));
    expect(stickToBottomMocks.stopScroll.mock.calls.length).toBeGreaterThan(wheelStopCalls);

    rerender(<ChatConversationFollow active={false} />);
    const stoppedCalls = stickToBottomMocks.stopScroll.mock.calls.length;
    act(() => stickToBottomMocks.scrollElement!.dispatchEvent(new WheelEvent('wheel')));
    expect(stickToBottomMocks.stopScroll).toHaveBeenCalledTimes(stoppedCalls);
    rerender(<ChatConversationFollow active />);
    expect(stickToBottomMocks.scrollToBottom).toHaveBeenCalledTimes(2);
  });
});

describe('ChatMessageBubble layout', () => {
  it('uses the full message column for assistant responses', () => {
    const { container } = render(<ChatMessageBubble message={{ id: 'a1', role: 'assistant', content: 'Answer' }} />);
    const column = container.querySelector('[data-message-role="assistant"] > div');

    expect(column).toHaveClass('w-full', 'min-w-0');
    expect(column).not.toHaveClass('md:max-w-[80%]');
  });

  it('keeps user messages compact and right aligned', () => {
    const { container } = render(<ChatMessageBubble message={{ id: 'u1', role: 'user', content: 'Question' }} />);
    const row = container.querySelector('[data-message-role="user"]');
    const column = container.querySelector('[data-message-role="user"] > div');

    expect(row).toHaveClass('flex-row-reverse');
    expect(column).toHaveClass('max-w-[92%]', 'md:max-w-[72%]');
  });

  it('formats message metadata with the active application language', () => {
    const timestamp = new Date('2026-07-21T10:13:42Z');
    render(<ChatMessageBubble message={{ id: 'u1', role: 'user', content: 'Question', timestamp, isEdited: true }} footerActions={<button type='button'>Copy</button>} />);

    const actions = screen.getByRole('button', { name: 'Copy' });
    const formattedTimestamp = screen.getByText(new Intl.DateTimeFormat('fr', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp).replace(' à', ','));
    expect(actions.compareDocumentPosition(formattedTimestamp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('Modifié')).toBeInTheDocument();
  });

  it('localizes the default empty state while preserving caller overrides', () => {
    const { rerender } = render(<ChatConversationEmptyState />);
    expect(screen.getByText('Démarrer une conversation')).toBeInTheDocument();
    expect(screen.getByText('Envoyez un message pour commencer à échanger avec l’IA')).toBeInTheDocument();

    rerender(<ChatConversationEmptyState title='Custom title' description='Custom description' />);
    expect(screen.getByText('Custom title')).toBeInTheDocument();
    expect(screen.getByText('Custom description')).toBeInTheDocument();
  });
});
