import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Task, TaskTrigger } from './task';

describe('TaskTrigger', () => {
  it('animates an active task with reduced-motion fallbacks', () => {
    const { container } = render(
      <Task>
        <TaskTrigger title='Smart Agent' active />
      </Task>,
    );

    expect(screen.getByText('Smart Agent').parentElement).toHaveAttribute('data-active', 'true');
    expect(container.querySelector('.animate-agent-scan')).toHaveClass('motion-reduce:animate-none');
    expect(container.querySelector('.animate-ping')).toHaveClass('motion-reduce:animate-none');
  });

  it('keeps inactive tasks static', () => {
    const { container } = render(
      <Task>
        <TaskTrigger title='Smart Agent' />
      </Task>,
    );

    expect(screen.getByText('Smart Agent').parentElement).not.toHaveAttribute('data-active');
    expect(container.querySelector('.animate-agent-scan')).not.toBeInTheDocument();
    expect(container.querySelector('.animate-ping')).not.toBeInTheDocument();
  });
});
