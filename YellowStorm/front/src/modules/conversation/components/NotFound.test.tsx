import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { mockNavigate } from '@/test/setup';
import { NotFound } from './NotFound';

vi.mock('@/components/ai-elements/chat-conversation', () => ({
  ChatConversationEmptyState: ({ title, description }: { title: string; description: string }) => (
    <div>
      <h1>{title}</h1>
      <p>{description}</p>
    </div>
  ),
}));

describe('NotFound', () => {
  it('renders translation keys and navigates back', async () => {
    render(<NotFound />);

    expect(screen.getByText('notFound.title')).toBeInTheDocument();
    expect(screen.getByText('notFound.description')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'notFound.back' }));
    expect(mockNavigate).toHaveBeenCalledWith('/');
  });
});
