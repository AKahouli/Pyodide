import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { AIMessageContent, type TaskPart } from './ai-message-content';

function renderTask(status: TaskPart['status'], isStreaming = true) {
  return render(
    <AIMessageContent
      isStreaming={isStreaming}
      parts={[{ type: 'task', title: 'smart_agent', items: ['Working'], status }]}
    />,
  );
}

describe('AIMessageContent task activity', () => {
  it('animates only an in-progress task while streaming', () => {
    const { container } = renderTask('in_progress');

    expect(screen.getByText('Smart Agent').parentElement).toHaveAttribute('data-active', 'true');
    expect(container.querySelector('[data-agent-spinner]')).toHaveClass('animate-spin');
    expect(container.querySelector('[data-agent-spinner]')).not.toHaveClass('motion-reduce:animate-none');
    expect(container.querySelector('[data-agent-scan]')).toHaveClass('animate-agent-scan');
    expect(container.querySelector('[data-agent-scan]')).not.toHaveClass('motion-reduce:animate-none');
  });

  it.each([undefined, 'pending'] as const)(
    'keeps %s tasks visibly active while the response is streaming',
    (status) => {
      const { container } = renderTask(status);

      expect(screen.getByText('Smart Agent').parentElement).toHaveAttribute('data-active', 'true');
      expect(container.querySelector('[data-agent-scan]')).toBeInTheDocument();
    },
  );

  it('keeps completed and non-streaming tasks static', () => {
    const completed = renderTask('completed');
    expect(screen.getByText('Smart Agent').parentElement).not.toHaveAttribute('data-active');
    expect(completed.container.querySelector('[data-agent-scan]')).not.toBeInTheDocument();
    completed.unmount();

    const idle = renderTask('in_progress', false);
    expect(screen.getByText('Smart Agent').parentElement).not.toHaveAttribute('data-active');
    expect(idle.container.querySelector('[data-agent-spinner]')).not.toBeInTheDocument();
  });

  it('shows safe activity and moves raw task context into diagnostics', async () => {
    render(
      <AIMessageContent
        taskDisplay='activity'
        parts={[
          { type: 'task', title: 'smart_agent', items: ['<original_user_request>Audit revenue</original_user_request> secret=hidden'], status: 'completed' },
          { type: 'toolActivity', toolName: 'search_documents', summary: '', renderKind: 'search', status: 'completed', paramsJson: '{"token":"private"}' },
        ]}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: /Smart Agent/ }));
    expect(screen.getByText('ai.task.activity.completed')).toBeInTheDocument();
    expect(screen.queryByText('Search Documents')).not.toBeInTheDocument();
    expect(screen.queryByText(/Review request token/)).not.toBeInTheDocument();
    expect(screen.queryByText(/original_user_request/)).not.toBeInTheDocument();
    expect(screen.queryByText(/corrective_replay_context/)).not.toBeInTheDocument();
    expect(screen.queryByText(/token/)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'ai.task.diagnostics.open' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Diagnostics render the stored context verbatim (no display-time redaction).
    expect(screen.getByText(/original_user_request/)).toHaveTextContent('secret=hidden');
    expect(screen.queryByText(/corrective_replay_context/)).not.toBeInTheDocument();
  });

  it('renders credential-like diagnostics verbatim without redaction', async () => {
    render(<AIMessageContent taskDisplay='activity' parts={[{
      type: 'task', title: 'smart_agent', status: 'completed', items: [
        'token=one refresh_token=two id_token=three API key=six access token=seven client secret=eight connection string=nine\nAuthorization: Basic dXNlcjpwYXNz\nCookie: session=four\nhttps://user:five@example.com',
      ],
    }]} />);

    await userEvent.click(screen.getByRole('button', { name: 'ai.task.diagnostics.open' }));
    const context = screen.getByText(/token=one/);
    expect(context).toHaveTextContent('refresh_token=two');
    expect(context).toHaveTextContent('dXNlcjpwYXNz');
    expect(context).toHaveTextContent('session=four');
    expect(screen.queryByText(/\[REDACTED\]/)).not.toBeInTheDocument();
  });

  it('can suppress diagnostics for non-participant surfaces', () => {
    render(<AIMessageContent taskDisplay='activity' showTaskDiagnostics={false} parts={[{
      type: 'task', title: 'smart_agent', status: 'completed', items: ['Raw context'],
    }]} />);

    expect(screen.queryByRole('button', { name: 'ai.task.diagnostics.open' })).not.toBeInTheDocument();
    expect(screen.queryByText('Raw context')).not.toBeInTheDocument();
  });

  it('shows original diagnostics when redaction is explicitly disabled', async () => {
    render(<AIMessageContent taskDisplay='activity' redactTaskDiagnostics={false} parts={[{
      type: 'task', title: 'smart_agent', status: 'completed', items: ['password=private'],
    }]} />);

    await userEvent.click(screen.getByRole('button', { name: 'ai.task.diagnostics.open' }));
    expect(screen.getByText('password=private')).toBeInTheDocument();
    expect(screen.queryByText(/\[REDACTED\]/)).not.toBeInTheDocument();
  });
});
