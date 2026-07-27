import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AIMessageContent, type TaskPart } from './ai-message-content';

function renderTask(status: TaskPart['status']) {
  return render(
    <AIMessageContent
      isStreaming
      parts={[{ type: 'task', title: 'smart_agent', items: ['Working'], status }]}
    />,
  );
}

describe('AIMessageContent task activity', () => {
  it('animates only an in-progress task while streaming', () => {
    const { container } = renderTask('in_progress');

    expect(screen.getByText('Smart Agent').parentElement).toHaveAttribute('data-active', 'true');
    expect(container.querySelector('.animate-agent-scan')).toBeInTheDocument();
  });

  it.each([undefined, 'pending', 'completed'] as const)(
    'keeps %s tasks static while streaming',
    (status) => {
      const { container } = renderTask(status);

      expect(screen.getByText('Smart Agent').parentElement).not.toHaveAttribute('data-active');
      expect(container.querySelector('.animate-agent-scan')).not.toBeInTheDocument();
    },
  );
});
