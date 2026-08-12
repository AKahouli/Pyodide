import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Task, TaskDiagnosticsTrigger, TaskTrigger } from './task';

describe('TaskTrigger', () => {
  it('keeps operational status motion active', () => {
    const { container } = render(
      <Task>
        <TaskTrigger title='Smart Agent' active />
      </Task>,
    );

    expect(screen.getByText('Smart Agent').parentElement).toHaveAttribute('data-active', 'true');
    expect(container.querySelector('[data-agent-scan]')).toHaveClass('animate-agent-scan');
    expect(container.querySelector('[data-agent-scan]')).not.toHaveClass('motion-reduce:animate-none');
    expect(container.querySelector('[data-agent-spinner]')).toHaveClass('animate-spin');
    expect(container.querySelector('[data-agent-spinner]')).not.toHaveClass('motion-reduce:animate-none');
  });

  it('keeps inactive tasks static', () => {
    const { container } = render(
      <Task>
        <TaskTrigger title='Smart Agent' />
      </Task>,
    );

    expect(screen.getByText('Smart Agent').parentElement).not.toHaveAttribute('data-active');
    expect(container.querySelector('[data-agent-scan]')).not.toBeInTheDocument();
    expect(container.querySelector('[data-agent-spinner]')).not.toBeInTheDocument();
  });

  it('renders diagnostics as an independent accessible control', () => {
    render(
      <Task>
        <div>
          <TaskTrigger title='Smart Agent' />
          <TaskDiagnosticsTrigger aria-label='Open diagnostics' />
        </div>
      </Task>,
    );

    expect(screen.getByRole('button', { name: 'Open diagnostics' })).toBeInTheDocument();
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
