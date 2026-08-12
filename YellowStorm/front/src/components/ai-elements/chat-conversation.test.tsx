import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ChatConversationEmptyState, ChatMessageBubble } from './chat-conversation';

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
    render(<ChatMessageBubble message={{ id: 'u1', role: 'user', content: 'Question', timestamp, isEdited: true }} />);

    expect(screen.getByText(new Intl.DateTimeFormat('fr', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(timestamp).replace(' à', ','))).toBeInTheDocument();
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
