import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { BranchNavigation } from './BranchNavigation';

const navigateBranchMock = vi.fn();

vi.mock('../store', () => ({
  useConversationStore: (selector: (state: { navigateBranch: (id: string, direction: 'prev' | 'next') => void }) => unknown) =>
    selector({ navigateBranch: navigateBranchMock }),
}));

describe('BranchNavigation', () => {
  it('does not render with a single branch', () => {
    const { container } = render(
      <BranchNavigation userMessageId='u1' branches={[{ id: 'a1' } as never]} activeBranchId='a1' />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('navigates between branches', async () => {
    render(
      <BranchNavigation
        userMessageId='u1'
        branches={[{ id: 'a1' } as never, { id: 'a2' } as never]}
        activeBranchId='a2'
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'branchNavigation.previous' }));
    expect(navigateBranchMock).toHaveBeenCalledWith('u1', 'prev');
  });
});
