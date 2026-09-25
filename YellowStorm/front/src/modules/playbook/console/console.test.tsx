import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlaybookVM } from '../utils/playbookVM';
import { buildPlaybookVM, type RawPlaybookListItem } from '../utils/playbookVM';
import { PlaybookTable } from './PlaybookTable';
import { SegmentTabs } from './SegmentTabs';
import { FilterBar } from './FilterBar';
import { PlaybookDrawer } from './PlaybookDrawer';
import { BulkActionBar } from './BulkActionBar';
import { AttentionRail } from './AttentionRail';
import type { RailActions } from './AttentionRail';
import { parseConsoleState } from './consoleState';
import type { PlaybookActions } from './types';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key, language: 'en' }),
}));

function raw(overrides: Partial<RawPlaybookListItem> = {}): RawPlaybookListItem {
  return {
    id: 'p1',
    name: 'Alpha',
    description: 'A playbook.',
    taskCount: 0,
    isFavorite: false,
    scheduleEnabled: false,
    executionStatus: 'completed',
    lastExecutionAt: '2026-03-01T10:00:00.000Z',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
    nodes: [{ id: 'n1' }, { id: 'n2' }],
    ...overrides,
  };
}

const twoVms = (): PlaybookVM[] => [
  buildPlaybookVM(raw({ id: 'p1', name: 'Alpha', executionStatus: 'running' }), {
    history: [{ id: 'r1', status: 'completed' } as never],
  }),
  buildPlaybookVM(raw({ id: 'p2', name: 'Beta', executionStatus: 'failed', lastExecutionAt: '2026-03-05T10:00:00.000Z' }), {}),
];

const noopActions = {
  onOpen: vi.fn(), onRun: vi.fn(), onEditCanvas: vi.fn(), onEditDetails: vi.fn(),
  onClone: vi.fn(), onDelete: vi.fn(), onToggleFavorite: vi.fn(), onOpenTriggers: vi.fn(),
  onIntegration: vi.fn(), onWatchRun: vi.fn(),
} satisfies PlaybookActions;

describe('AttentionRail', () => {
  it('shows a localized fallback instead of a raw approval step ID', () => {
    const vm = buildPlaybookVM(raw({ executionStatus: 'pending_approval' }), {
      liveExecution: {
        id: 'e1', status: 'pending_approval', playbookId: 'p1', updatedAt: new Date().toISOString(),
        interruptPayload: { type: 'human_approval', taskId: 'internal-id', taskTitle: '', message: 'Approve?', threadId: 't1' },
      } as never,
    });
    const actions: RailActions = { onWatchRun: vi.fn(), onStop: vi.fn(), onApprove: vi.fn(), onRetry: vi.fn(), onMore: vi.fn() };
    render(<AttentionRail vms={[vm]} actions={actions} />);
    const waiting = screen.getByTestId('rail-waiting');
    expect(within(waiting).getByText('console.rail.waiting.step')).toBeInTheDocument();
    expect(within(waiting).queryByText('internal-id')).not.toBeInTheDocument();
  });
});

describe('PlaybookTable', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sorts by clicking each sortable column header', async () => {
    const user = userEvent.setup();
    const onSort = vi.fn();
    render(<PlaybookTable vms={twoVms()} sort="lastRun" dir="desc" onSort={onSort} selected={new Set()} onToggleSelect={vi.fn()} actions={noopActions} showReliability />);
    for (const label of ['console.col.playbook', 'console.col.state', 'console.col.reliability', 'console.col.steps', 'console.col.lastRun']) {
      await user.click(screen.getByRole('button', { name: new RegExp(label) }));
    }
    expect(onSort).toHaveBeenNthCalledWith(1, 'name');
    expect(onSort).toHaveBeenNthCalledWith(2, 'state');
    expect(onSort).toHaveBeenNthCalledWith(3, 'reliability');
    expect(onSort).toHaveBeenNthCalledWith(4, 'steps');
    expect(onSort).toHaveBeenNthCalledWith(5, 'lastRun');
  });

  it('marks the active column with aria-sort', () => {
    render(<PlaybookTable vms={twoVms()} sort="name" dir="asc" onSort={vi.fn()} selected={new Set()} onToggleSelect={vi.fn()} actions={noopActions} showReliability />);
    expect(screen.getByText('console.col.playbook').closest('th')).toHaveAttribute('aria-sort', 'ascending');
  });

  it('opens the drawer on row click and toggles selection with Space', async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const onToggleSelect = vi.fn();
    const actions = { ...noopActions, onOpen };
    render(<PlaybookTable vms={twoVms()} sort="name" dir="asc" onSort={vi.fn()} selected={new Set()} onToggleSelect={onToggleSelect} actions={actions} showReliability />);
    await user.click(screen.getByText('Beta'));
    expect(onOpen).toHaveBeenCalledTimes(1);
    screen.getByText('Beta').closest('tr')!.focus();
    await user.keyboard(' ');
    expect(onToggleSelect).toHaveBeenCalledWith('p2');
  });

  it('toggles selection from the row checkbox', async () => {
    const user = userEvent.setup();
    const onToggleSelect = vi.fn();
    render(<PlaybookTable vms={twoVms()} sort="name" dir="asc" onSort={vi.fn()} selected={new Set(['p1'])} onToggleSelect={onToggleSelect} actions={noopActions} showReliability />);
    await user.click(screen.getAllByRole('checkbox', { name: 'console.selectRowName' })[0]);
    expect(onToggleSelect).toHaveBeenCalledWith('p1');
  });

  it('hides the Reliability column entirely when no history is loaded (§5.3)', () => {
    render(<PlaybookTable vms={twoVms()} sort="name" dir="asc" onSort={vi.fn()} selected={new Set()} onToggleSelect={vi.fn()} actions={noopActions} showReliability={false} />);
    expect(screen.queryByText('console.col.reliability')).toBeNull();
  });
});

describe('SegmentTabs', () => {
  it('switches segments and renders counts only when non-zero', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentTabs counts={{ all: 3, shared: 1, live: 1, fav: 0, scheduled: 0, never: 2 }} active="all" onChange={onChange} />);
    await user.click(screen.getByRole('tab', { name: /console\.segment\.shared/ }));
    expect(onChange).toHaveBeenCalledWith('shared');
    await user.click(screen.getByRole('tab', { name: /console\.segment\.live/ }));
    expect(onChange).toHaveBeenCalledWith('live');
    expect(screen.getByRole('tab', { name: /console\.segment\.live/ }).textContent).toMatch(/1/);
    expect(screen.getByRole('tab', { name: /console\.segment\.fav/ }).textContent).not.toMatch(/0/);
  });
});

describe('FilterBar status chips', () => {
  it('multi-selects states additively and clears', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const base = parseConsoleState(new URLSearchParams(), null, 100);
    const view = render(
      <FilterBar
        state={base}
        onChange={onChange}
        statesPresent={[
          { state: 'running', count: 2 },
          { state: 'failed', count: 1 },
          { state: 'idle', count: 0 },
        ]}
        segmentCounts={{ matched: 3, total: 3 }}
      />,
    );
    expect(screen.queryByText(/status\.idle/)).toBeNull(); // zero-count chip not rendered (B4)
    await user.click(screen.getByText('status.running'));
    expect(onChange).toHaveBeenLastCalledWith({ states: ['running'] });
    // The page re-renders with the committed state; simulate that.
    view.rerender(
      <FilterBar
        state={{ ...base, states: ['running'] }}
        onChange={onChange}
        statesPresent={[
          { state: 'running', count: 2 },
          { state: 'failed', count: 1 },
          { state: 'idle', count: 0 },
        ]}
        segmentCounts={{ matched: 3, total: 3 }}
      />,
    );
    await user.click(screen.getByText('status.failed'));
    expect(onChange).toHaveBeenLastCalledWith({ states: ['running', 'failed'] });
    view.rerender(
      <FilterBar
        state={{ ...base, states: ['running', 'failed'] }}
        onChange={onChange}
        statesPresent={[
          { state: 'running', count: 2 },
          { state: 'failed', count: 1 },
          { state: 'idle', count: 0 },
        ]}
        segmentCounts={{ matched: 3, total: 3 }}
      />,
    );
    await user.click(screen.getByText('console.chipClear'));
    expect(onChange).toHaveBeenLastCalledWith({ states: [] });
  });

  it('switches views from the view switcher', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <FilterBar state={parseConsoleState(new URLSearchParams(), null, 100)} onChange={onChange} statesPresent={[]} segmentCounts={{ matched: 0, total: 0 }} />,
    );
    await user.click(screen.getByRole('button', { name: 'console.view.board' }));
    expect(onChange).toHaveBeenCalledWith({ view: 'board' });
  });
});

describe('PlaybookDrawer', () => {
  it('renders as a dialog and closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const vm = buildPlaybookVM(raw({ id: 'p1', name: 'Alpha', description: 'Purpose line.' }), {
      history: [{ id: 'r1', executionNumber: 3, status: 'completed', durationMs: 4000 } as never],
    });
    render(<PlaybookDrawer vm={vm} actions={noopActions} onOpenRun={vi.fn()} onClose={onClose} />);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Alpha')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('renders nothing without a playbook', () => {
    const { container } = render(<PlaybookDrawer vm={null} actions={noopActions} onOpenRun={vi.fn()} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('BulkActionBar', () => {
  it('shows the selection count and clears the selection', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    render(<BulkActionBar count={2} onRun={vi.fn()} onClone={vi.fn()} onDelete={vi.fn()} onClear={onClear} />);
    expect(screen.getByTestId('bulk-count')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'console.bulk.clear' }));
    expect(onClear).toHaveBeenCalled();
  });

  it('renders nothing with an empty selection', () => {
    const { container } = render(<BulkActionBar count={0} onRun={vi.fn()} onClone={vi.fn()} onDelete={vi.fn()} onClear={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});
