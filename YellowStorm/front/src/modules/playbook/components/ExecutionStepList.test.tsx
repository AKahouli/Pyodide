import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionStepList } from './ExecutionStepList';
import type { TaskResult } from '../types';

const baseResult: TaskResult = {
  taskId: 't1',
  nodeTitle: 'Analyze Data',
  agentName: 'Analyzer',
  order: 1,
  status: 'completed',
  output: null,
  error: null,
  durationMs: 1234,
  startedAt: '2025-01-01T00:00:00.000Z',
  completedAt: '2025-01-01T00:00:01.234Z',
};

describe('ExecutionStepList', () => {
  it('renders step titles sorted by order', () => {
    const results: TaskResult[] = [
      { ...baseResult, taskId: 't2', nodeTitle: 'Step B', order: 2 },
      { ...baseResult, taskId: 't1', nodeTitle: 'Step A', order: 1 },
    ];
    render(<ExecutionStepList taskResults={results} selectedStepId={null} onSelectStep={vi.fn()} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons[0]).toHaveTextContent('Step A');
    expect(buttons[1]).toHaveTextContent('Step B');
  });

  it('highlights the selected step', () => {
    render(<ExecutionStepList taskResults={[baseResult]} selectedStepId="t1" onSelectStep={vi.fn()} />);
    const button = screen.getByRole('button');
    expect(button.className).toContain('bg-accent');
  });

  it('calls onSelectStep when a step is clicked', async () => {
    const onSelect = vi.fn();
    render(<ExecutionStepList taskResults={[baseResult]} selectedStepId={null} onSelectStep={onSelect} />);
    await userEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith('t1');
  });

  it('shows agent name and duration', () => {
    render(<ExecutionStepList taskResults={[baseResult]} selectedStepId={null} onSelectStep={vi.fn()} />);
    expect(screen.getByText('Analyzer')).toBeInTheDocument();
    expect(screen.getByText('1.2s')).toBeInTheDocument();
  });

  it('shows error text for failed steps', () => {
    const failed: TaskResult = { ...baseResult, status: 'failed', error: 'Connection timeout' };
    render(<ExecutionStepList taskResults={[failed]} selectedStepId={null} onSelectStep={vi.fn()} />);
    expect(screen.getByText('Connection timeout')).toBeInTheDocument();
  });
});
