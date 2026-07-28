import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChatMessageBubble } from './chat-conversation';

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
});
