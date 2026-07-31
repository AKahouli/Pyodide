import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (k === 'agents.card.tasksProgress') return `${opts?.done} of ${opts?.total} tasks`;
      return (({
        'agents.status.working': 'Working',
        'agents.card.standingBy': 'Standing by',
      }) as Record<string, string>)[k] ?? k;
    },
    language: 'en',
    ready: true,
  }),
}));

import { AgentCard } from './AgentCard';
import type { WorkyAgent } from '../../agents/agentModel';
import type { WorkyTask } from '../../types';

const agent: WorkyAgent = {
  key: 'researcher',
  name: 'Atlas',
  role: 'Research',
  initials: 'A',
  colorSeed: 'x',
  status: 'working',
  currentTask: { title: 'Drafting the competitor analysis' } as WorkyTask,
  tasks: [
    { id: 't1', title: 'Task one', lane: 'running' } as WorkyTask,
    { id: 't2', title: 'Task two', lane: 'done' } as WorkyTask,
  ],
  doneCount: 3,
  totalCount: 5,
};

const noop = () => {};

describe('AgentCard', () => {
  it('renders identity, current task and progress', () => {
    render(<AgentCard agent={agent} expanded={false} onToggle={noop} onOpenTask={noop} />);
    expect(screen.getByText('Atlas')).toBeTruthy();
    expect(screen.getByText('Research')).toBeTruthy();
    expect(screen.getByText('Drafting the competitor analysis')).toBeTruthy();
    expect(screen.getByText('3 of 5 tasks')).toBeTruthy();
  });

  it('falls back to "Standing by" when there is no current task', () => {
    render(
      <AgentCard
        agent={{ ...agent, currentTask: null, status: 'idle' }}
        expanded={false}
        onToggle={noop}
        onOpenTask={noop}
      />,
    );
    expect(screen.getByText('Standing by')).toBeTruthy();
  });

  it('hides the task list until expanded', () => {
    render(<AgentCard agent={agent} expanded={false} onToggle={noop} onOpenTask={noop} />);
    expect(screen.queryByText('Task one')).toBeNull();
  });

  it('reveals the task list inline when expanded', () => {
    render(<AgentCard agent={agent} expanded onToggle={noop} onOpenTask={noop} />);
    expect(screen.getByText('Task one')).toBeTruthy();
    expect(screen.getByText('Task two')).toBeTruthy();
  });

  it('calls onToggle when the header is clicked', async () => {
    const onToggle = vi.fn();
    render(<AgentCard agent={agent} expanded={false} onToggle={onToggle} onOpenTask={noop} />);
    await userEvent.click(screen.getByText('Atlas'));
    expect(onToggle).toHaveBeenCalledWith(agent);
  });

  it('opens a task from the expanded list', async () => {
    const onOpenTask = vi.fn();
    render(<AgentCard agent={agent} expanded onToggle={noop} onOpenTask={onOpenTask} />);
    await userEvent.click(screen.getByText('Task one'));
    expect(onOpenTask).toHaveBeenCalledWith(agent.tasks[0]);
  });
});
