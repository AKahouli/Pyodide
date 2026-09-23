import { render, screen } from '@testing-library/react';
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
  };
}

describe('CurrentWorkSection', () => {
  it('groups attention, active and remaining tasks, expands the remaining list, and opens a task', async () => {
    const onTaskClick = vi.fn();
    const dependency = { id: 'dep', title: 'Prerequisite' } as WorkyTask;
    const items = [item('failed', 'failed'), item('running', 'running'), ...Array.from({ length: 5 }, (_, index) => item(`next-${index}`, 'pending', index === 0 ? [dependency] : []))];
    render(<CurrentWorkSection items={items} onTaskClick={onTaskClick} />);

    expect(screen.getByRole('heading', { name: 'executive.currentWork.attention1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'executive.currentWork.active1' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'executive.currentWork.remaining5' })).toBeInTheDocument();
    expect(screen.getByText('executive.currentWork.waitingOnPrerequisite')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /next-4/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'executive.currentWork.showAll5' }));
    await userEvent.click(screen.getByRole('button', { name: /next-4/ }));
    expect(onTaskClick).toHaveBeenCalledWith(items[6].task);
  });

  it('focuses and highlights a newly urgent task', () => {
    const tasks = [item('urgent', 'failed')];
    const { rerender } = render(<CurrentWorkSection items={tasks} onTaskClick={() => {}} />);
    rerender(<CurrentWorkSection items={tasks} onTaskClick={() => {}} attention={{ taskId: 'urgent', sequence: 1 }} />);
    const row = screen.getByRole('button', { name: /urgent/ });
    expect(row).toHaveFocus();
    expect(row).toHaveClass('ring-amber-500');
    expect(screen.getByRole('status')).toHaveTextContent('executive.currentWork.newAttentionurgent');
  });
});
