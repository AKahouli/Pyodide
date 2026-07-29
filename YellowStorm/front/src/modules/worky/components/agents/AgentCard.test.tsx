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
  tasks: [],
  doneCount: 3,
  totalCount: 5,
};

describe('AgentCard', () => {
  it('renders identity, current task and progress', () => {
    render(<AgentCard agent={agent} onOpen={() => {}} />);
    expect(screen.getByText('Atlas')).toBeTruthy();
    expect(screen.getByText('Research')).toBeTruthy();
    expect(screen.getByText('Drafting the competitor analysis')).toBeTruthy();
    expect(screen.getByText('3 of 5 tasks')).toBeTruthy();
  });

  it('falls back to "Standing by" when there is no current task', () => {
    render(<AgentCard agent={{ ...agent, currentTask: null, status: 'idle' }} onOpen={() => {}} />);
    expect(screen.getByText('Standing by')).toBeTruthy();
  });

  it('calls onOpen when clicked', async () => {
    const onOpen = vi.fn();
    render(<AgentCard agent={agent} onOpen={onOpen} />);
    await userEvent.click(screen.getByText('Atlas'));
    expect(onOpen).toHaveBeenCalledWith(agent);
  });
});
