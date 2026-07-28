import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('shows safe activity and moves raw task context into diagnostics', async () => {
    render(
      <AIMessageContent
        taskDisplay='activity'
        parts={[
          { type: 'task', title: 'smart_agent', items: ['<original_user_request>Audit revenue</original_user_request> secret=hidden'], status: 'completed' },
          { type: 'chainOfThought', steps: ['review_documents', '<corrective_replay_context>private</corrective_replay_context>'] },
          { type: 'toolInfo', title: 'search_documents', status: 'completed', params: '{"token":"private"}' },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Smart Agent/ }));
    expect(screen.getByText('Review Documents')).toBeInTheDocument();
    expect(screen.getByText('Search Documents')).toBeInTheDocument();
    expect(screen.queryByText(/original_user_request/)).not.toBeInTheDocument();
    expect(screen.queryByText(/corrective_replay_context/)).not.toBeInTheDocument();
    expect(screen.queryByText(/token/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ai.task.diagnostics.open' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/original_user_request/)).toHaveTextContent('secret=[REDACTED]');
    expect(screen.queryByText(/corrective_replay_context/)).not.toBeInTheDocument();
  });
});
