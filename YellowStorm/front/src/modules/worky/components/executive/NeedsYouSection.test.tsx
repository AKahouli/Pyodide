import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NeedsYouSection } from './NeedsYouSection';
import type { WorkyExecutiveViewModel } from '../../executive/executiveModel';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));
// The interactive card owns its own approve/decline/edit flow (tested in
// PendingApprovalCard.test.tsx); here we only assert NeedsYouSection routes a
// pending approval to it — the pre-merge behaviour, not a "review in chat" button.
vi.mock('./PendingApprovalCard', () => ({
  PendingApprovalCard: ({ approval }: { approval: { questionId: string } }) => (
    <div data-testid='pending-approval-card'>{approval.questionId}</div>
  ),
}));

describe('NeedsYouSection', () => {
  it('renders a pending approval as the interactive approval card', () => {
    const model = {
      plan: null, session: null, health: 'needs_attention' as const, currentWork: [], allTasks: [], completedTasks: [], deliveryPaths: [], recentTasks: [], delegations: [],
      summary: { total: 0, completed: 0, active: 0, blocked: 0, remaining: 0, waitingExternal: 0, needsInput: 1 },
      runtimeAsks: [], interactions: [], pendingApprovals: [{ questionId: 'confirm::call-1', component: {
        id: 'choice-1', type: 'choice', data: {
          schemaVersion: 1, status: 'ready', questionId: 'confirm::call-1', prompt: 'Review send',
          presentation: 'quick_replies', selectionMode: 'single', submitBehavior: 'immediate',
          options: [{ id: 'approve', label: 'Approve', submitText: 'approve' }, { id: 'decline', label: 'Decline', submitText: 'decline' }],
        },
      } }],
    } as WorkyExecutiveViewModel;

    render(<NeedsYouSection streamId='stream-1' model={model} onReviewApproval={vi.fn()} />);
    expect(screen.getByTestId('pending-approval-card')).toHaveTextContent('confirm::call-1');
  });
});
