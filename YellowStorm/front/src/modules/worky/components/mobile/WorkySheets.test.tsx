import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (k: string) => k, language: 'en', ready: true }),
}));

// Replace the heavy child content components with stubs — we test the sheet wrappers.
vi.mock('../TaskDetailDrawer', () => ({
  TaskDetailDrawer: ({ task }: { task: { title: string } | null }) => <div>drawer:{task?.title}</div>,
}));

const mutateAsync = vi.fn().mockResolvedValue(undefined);
vi.mock('../../query/hooks', () => ({ useRespondInteraction: () => ({ mutateAsync }) }));

import { TaskDetailSheet } from './TaskDetailSheet';
import { ApprovalSheet } from './ApprovalSheet';
import type { WorkyPendingClarification } from '../../types';

const interaction = {
  id: 'int-1',
  type: 'approval',
  question: 'Send outreach emails to 240 contacts?',
  options: [],
  taskId: null,
  blocksTaskIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
} as unknown as WorkyPendingClarification;

beforeEach(() => vi.clearAllMocks());

describe('TaskDetailSheet', () => {
  it('renders the task drawer with the task when open', () => {
    render(
      <TaskDetailSheet task={{ title: 'Do the thing' } as never} open onOpenChange={() => {}} />,
    );
    expect(screen.getByText('drawer:Do the thing')).toBeTruthy();
  });
});

describe('ApprovalSheet', () => {
  it('shows the question and approves via the respond hook', async () => {
    const onOpenChange = vi.fn();
    render(
      <ApprovalSheet streamId="s1" interaction={interaction} open onOpenChange={onOpenChange} />,
    );
    expect(screen.getByText('Send outreach emails to 240 contacts?')).toBeTruthy();
    await userEvent.click(screen.getByText('approval.approve'));
    expect(mutateAsync).toHaveBeenCalledWith(
      expect.objectContaining({ interactionId: 'int-1', approve: true }),
    );
  });
});
