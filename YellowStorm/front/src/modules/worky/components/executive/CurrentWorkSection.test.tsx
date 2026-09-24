import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CurrentWorkSection } from './CurrentWorkSection';
import type { WorkyCurrentWorkItem } from '../../executive/executiveModel';
import type { WorkyTask } from '../../types';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string, params?: Record<string, unknown>) => `${key}${params?.count ?? params?.task ?? ''}` }),
}));

function item(id: string, status: WorkyCurrentWorkItem['status'], openPrerequisites: WorkyTask[] = []): WorkyCurrentWorkItem {
  return {
    task: { id, title: id, assigneeName: 'Owner' } as WorkyTask,
    status,
    openPrerequisites,
    canceledPrerequisites: 0,
    unavailablePrerequisites: 0,
    downstreamCount: 0,
  };
}

describe('CurrentWorkSection', () => {
  it('filters attention, active and upcoming tasks and opens a task', async () => {
    const onTaskClick = vi.fn();
    const dependency = { id: 'dep', title: 'Prerequisite' } as WorkyTask;
    const items = [item('failed', 'failed'), item('running', 'running'), ...Array.from({ length: 5 }, (_, index) => item(`next-${index}`, 'pending', index === 0 ? [dependency] : []))];
    render(<CurrentWorkSection items={items} onTaskClick={onTaskClick} />);

    expect(screen.getByRole('button', { name: 'command.table.attention 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'command.table.active 1' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'command.table.upNext 5' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next-4/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'command.table.upNext 5' }));
    expect(screen.getByText('executive.currentWork.waitingOnPrerequisite')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /next-4/ }));
    expect(onTaskClick).toHaveBeenCalledWith(items[6].task);
  });

  it('focuses and highlights a newly urgent task', async () => {
    const tasks = [item('urgent', 'failed')];
    const { rerender } = render(<CurrentWorkSection items={tasks} onTaskClick={() => {}} />);
    rerender(<CurrentWorkSection items={tasks} onTaskClick={() => {}} attention={{ taskId: 'urgent', sequence: 1 }} />);
    const row = screen.getByRole('button', { name: /urgent/ });
    await waitFor(() => expect(row).toHaveFocus());
    expect(row).toHaveClass('ring-amber-500');
    expect(screen.getByRole('status')).toHaveTextContent('executive.currentWork.newAttentionurgent');
  });

  it('identifies canceled and unresolved prerequisites instead of calling them ready', async () => {
    const canceled = { ...item('canceled dependency', 'pending'), canceledPrerequisites: 1 };
    const unresolved = { ...item('unresolved dependency', 'pending'), unavailablePrerequisites: 1 };
    render(<CurrentWorkSection items={[canceled, unresolved]} onTaskClick={() => {}} />);
    await userEvent.click(screen.getByRole('button', { name: 'command.table.upNext 2' }));
    expect(screen.getAllByText('command.table.waitingPrerequisite')).toHaveLength(2);
    expect(screen.getByText('executive.currentWork.canceledDependencies1')).toBeInTheDocument();
    expect(screen.getByText('executive.currentWork.unavailableDependencies1')).toBeInTheDocument();
    expect(screen.queryByText('command.table.noDependency')).not.toBeInTheDocument();
  });
});
