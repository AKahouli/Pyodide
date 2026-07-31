import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (k: string) => k, language: 'en', ready: true }),
}));

import { AgentTasksSheet } from './AgentTasksSheet';
import type { WorkyAgent } from '../../agents/agentModel';
import type { WorkyTask } from '../../types';

const agent: WorkyAgent = {
  key: 'a',
  name: 'Atlas',
  role: 'Research',
  initials: 'A',
  colorSeed: 'x',
  status: 'working',
  currentTask: null,
  tasks: [
    { id: 't1', title: 'Task one', lane: 'running' } as WorkyTask,
    { id: 't2', title: 'Task two', lane: 'done' } as WorkyTask,
  ],
  doneCount: 1,
  totalCount: 2,
};

describe('AgentTasksSheet', () => {
  it('lists the agent tasks with their lane', () => {
    render(<AgentTasksSheet agent={agent} open onOpenChange={() => {}} onOpenTask={() => {}} />);
    expect(screen.getByText('Task one')).toBeTruthy();
    expect(screen.getByText('Task two')).toBeTruthy();
    expect(screen.getAllByText('Atlas').length).toBeGreaterThan(0);
  });

  it('opens a task when its row is clicked', async () => {
    const onOpenTask = vi.fn();
    render(<AgentTasksSheet agent={agent} open onOpenChange={() => {}} onOpenTask={onOpenTask} />);
    await userEvent.click(screen.getByText('Task one'));
    expect(onOpenTask).toHaveBeenCalledWith(agent.tasks[0]);
  });
});
