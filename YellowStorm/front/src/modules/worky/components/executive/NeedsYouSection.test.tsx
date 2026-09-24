import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NeedsYouSection } from './NeedsYouSection';
import type { WorkyExecutiveViewModel } from '../../executive/executiveModel';

vi.mock('@/modules/localization', () => ({ useModuleTranslation: () => ({ t: (key: string) => key }) }));

describe('NeedsYouSection', () => {
  it('shows a pending approval and opens chat for review', async () => {
    const onReviewApproval = vi.fn();
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

    render(<NeedsYouSection streamId='stream-1' model={model} onReviewApproval={onReviewApproval} />);
    expect(screen.getByText('Review send')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'executive.needsYou.reviewInChat' }));
    expect(onReviewApproval).toHaveBeenCalledOnce();
  });
});
