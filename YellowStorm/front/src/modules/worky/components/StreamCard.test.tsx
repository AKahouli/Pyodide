import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WorkyStreamListItem } from '../types';
import { StreamCard } from './StreamCard';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({
    t: (k: string, vars?: Record<string, unknown>) =>
      vars ? `${k}:${JSON.stringify(vars)}` : k,
    language: 'en',
    ready: true,
  }),
}));

const baseStream: WorkyStreamListItem = {
  id: 's1',
  ownerUserId: 'u1',
  access: 'owner',
  workspaceId: 'w1',
  artifactWorkspaceId: null,
  managerAgentId: null,
  managerModelId: null,
  workerModelId: null,
  governancePolicyRef: null,
  title: 'Q3 Expansion',
  status: 'active',
  controlState: 'active',
  schedulerEnabled: false,
  currentPlanVersion: 3,
  executionPlanVersion: null,
  budget: { limitUsd: 10, limitTokens: 0, spendUsd: 4, tokensUsed: 0, enforcement: 'hard_stop' },
  startedAt: '2026-01-01T00:00:00Z',
  completedAt: null,
  activeDurationMinutes: 134,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  lastActivityAt: '2026-01-02T00:00:00Z',
  stats: { totalTasks: 12, running: 3, done: 8, blocked: 1, failed: 0, progress: 8 / 12 },
};

describe('StreamCard', () => {
  beforeEach(() => vi.clearAllMocks());

  const setup = (overrides: Partial<WorkyStreamListItem> = {}) => {
    const onOpen = vi.fn();
    const onDelete = vi.fn();
    render(
      <StreamCard
        stream={{ ...baseStream, ...overrides }}
        onOpen={onOpen}
        onDelete={onDelete}
        onShare={vi.fn()}
        isDeleting={false}
      />,
    );
    return { onOpen, onDelete };
  };

  it('renders the title, status label and elapsed time', () => {
    setup();
    expect(screen.getByText('Q3 Expansion')).toBeTruthy();
    // StatusBadge label for the real status
    expect(screen.getByText('badges.status.active')).toBeTruthy();
    // Elapsed derived from activeDurationMinutes (134 -> 2h 14m)
    expect(screen.getByText(/2h 14m/)).toBeTruthy();
  });

  it('renders the task-count line from stats', () => {
    setup();
    const tasks = screen.getByTestId('stream-card-tasks').textContent ?? '';
    expect(tasks).toContain('12');
    expect(tasks).toContain('3');
    expect(tasks).toContain('1');
  });

  it('renders the progress percentage (done/total)', () => {
    setup();
    // 8/12 = 67%
    expect(screen.getByTestId('stream-card-progress').textContent).toContain('67');
  });

  it('shows a no-tasks state when the stream has no tasks', () => {
    setup({ stats: { totalTasks: 0, running: 0, done: 0, blocked: 0, failed: 0, progress: 0 } });
    expect(screen.getByTestId('stream-card-tasks').textContent).toContain('dashboard.card.noTasks');
  });

  it('calls onOpen when the card body is clicked', () => {
    const { onOpen } = setup();
    fireEvent.click(screen.getByTestId('stream-card-open'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('calls onDelete from the delete control', () => {
    const { onDelete } = setup();
    fireEvent.click(screen.getByLabelText(/dashboard.deleteStream/));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
