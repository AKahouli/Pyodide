import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => {
      if (k === 'agents.team.unassignedCount') return `${opts?.count} unassigned tasks`;
      if (k === 'agents.card.tasksProgress') return `${opts?.done} of ${opts?.total} tasks`;
      return (({
        'agents.team.title': 'Team',
        'agents.team.empty': 'No agents yet',
        'agents.team.unassignedTitle': 'Unassigned work',
        'agents.card.standingBy': 'Standing by',
        'agents.status.idle': 'Idle',
        'agents.status.working': 'Working',
      }) as Record<string, string>)[k] ?? k;
    },
    language: 'en',
    ready: true,
  }),
}));

vi.mock('../../agents/useStreamAgents', () => ({ useStreamAgents: vi.fn() }));

import { useStreamAgents } from '../../agents/useStreamAgents';
import { AgentTeamView } from './AgentTeamView';
import type { WorkyAgent } from '../../agents/agentModel';
import type { WorkyTask } from '../../types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asMock = (fn: unknown) => fn as any;

const mkAgent = (over: Partial<WorkyAgent>): WorkyAgent => ({
  key: 'k',
  name: 'Atlas',
  role: 'Research',
  initials: 'A',
  colorSeed: 'x',
  status: 'idle',
  currentTask: null,
  tasks: [],
  doneCount: 0,
  totalCount: 1,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe('AgentTeamView', () => {
  it('renders a card per agent and the team count', () => {
    asMock(useStreamAgents).mockReturnValue({
      agents: [mkAgent({ key: 'a', name: 'Atlas' }), mkAgent({ key: 'b', name: 'Iris' })],
      ungrouped: [],
    });
    render(<AgentTeamView onOpenTask={() => {}} />);
    expect(screen.getByText('Atlas')).toBeTruthy();
    expect(screen.getByText('Iris')).toBeTruthy();
    expect(screen.getByText('Team')).toBeTruthy();
  });

  it('renders an empty state when there are no agents', () => {
    asMock(useStreamAgents).mockReturnValue({ agents: [], ungrouped: [] });
    render(<AgentTeamView onOpenTask={() => {}} />);
    expect(screen.getByText('No agents yet')).toBeTruthy();
  });

  it('renders the unassigned fallback when there are ungrouped tasks', () => {
    asMock(useStreamAgents).mockReturnValue({
      agents: [mkAgent({ key: 'a', name: 'Atlas' })],
      ungrouped: [{ id: '1' }, { id: '2' }],
    });
    render(<AgentTeamView onOpenTask={() => {}} />);
    expect(screen.getByText('Unassigned work')).toBeTruthy();
    expect(screen.getByText('2 unassigned tasks')).toBeTruthy();
  });

  it('expands cards in place and keeps several open at once', async () => {
    const task = { id: 't1', title: 'Task one', lane: 'running' } as WorkyTask;
    const other = { id: 't2', title: 'Task two', lane: 'done' } as WorkyTask;
    asMock(useStreamAgents).mockReturnValue({
      agents: [
        mkAgent({ key: 'a', name: 'Atlas', tasks: [task] }),
        mkAgent({ key: 'b', name: 'Iris', tasks: [other] }),
      ],
      ungrouped: [],
    });
    render(<AgentTeamView onOpenTask={() => {}} />);

    expect(screen.queryByText('Task one')).toBeNull();

    await userEvent.click(screen.getByTestId('agent-card-toggle-a'));
    expect(screen.getByText('Task one')).toBeTruthy();

    // Expanding a second agent leaves the first one open.
    await userEvent.click(screen.getByTestId('agent-card-toggle-b'));
    expect(screen.getByText('Task one')).toBeTruthy();
    expect(screen.getByText('Task two')).toBeTruthy();

    // Collapsing one leaves the other untouched.
    await userEvent.click(screen.getByTestId('agent-card-toggle-a'));
    expect(screen.queryByText('Task one')).toBeNull();
    expect(screen.getByText('Task two')).toBeTruthy();
  });

  it('hands a selected task up to the caller', async () => {
    const task = { id: 't1', title: 'Task one', lane: 'running' } as WorkyTask;
    const onOpenTask = vi.fn();
    asMock(useStreamAgents).mockReturnValue({
      agents: [mkAgent({ key: 'a', name: 'Atlas', tasks: [task] })],
      ungrouped: [],
    });
    render(<AgentTeamView onOpenTask={onOpenTask} />);

    await userEvent.click(screen.getByTestId('agent-card-toggle-a'));
    await userEvent.click(screen.getByText('Task one'));

    expect(onOpenTask).toHaveBeenCalledWith(task);
  });
});
