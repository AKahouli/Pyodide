import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExecutionDetailsPanel } from './ExecutionDetailsPanel';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../mobile/AgentTeamView', () => ({ AgentTeamView: () => <div>agents-view</div> }));
vi.mock('../KanbanBoard', () => ({ KanbanBoard: () => <div>tasks-view</div> }));
vi.mock('../WorkyGraphBoard', () => ({ WorkyGraphBoard: () => <div>map-view</div> }));

describe('ExecutionDetailsPanel', () => {
  it('normalizes a persisted tasks tab when access becomes read-only', () => {
    const { rerender } = render(
      <ExecutionDetailsPanel streamId="s1" onTaskClick={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('executive.execution.title'));
    fireEvent.click(screen.getByText('executive.execution.tasks'));
    expect(screen.getByText('tasks-view')).toBeTruthy();

    rerender(<ExecutionDetailsPanel streamId="s1" onTaskClick={vi.fn()} readOnly />);

    expect(screen.queryByText('tasks-view')).toBeNull();
    expect(screen.getByText('agents-view')).toBeTruthy();
  });
});
