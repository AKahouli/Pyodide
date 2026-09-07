import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceBindingCard } from './WorkspaceBindingCard';

const mocks = vi.hoisted(() => ({ deleteBinding: vi.fn() }));

vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...await importOriginal<typeof import('@tanstack/react-query')>(),
  useQuery: () => ({ data: { name: 'Credit Risk' }, isPending: false }),
}));

vi.mock('@/modules/workspace', () => ({ getWorkspace: vi.fn() }));

vi.mock('@/modules/governance', () => ({
  useDeleteGovernanceWorkspaceBinding: () => ({ mutate: mocks.deleteBinding, isPending: false }),
}));

describe('WorkspaceBindingCard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shows only the connected workspace and disconnect action', () => {
    render(<WorkspaceBindingCard programId='program-1' scopeId='scope-1' binding={{ id: 'binding-1', programId: 'program-1', workspaceId: 'workspace-1', visibility: 'scope_specific', scopeIds: ['scope-1'], enabled: true, createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z' }} />);

    expect(screen.getByText('Credit Risk')).toBeInTheDocument();
    expect(screen.getByText('workspaceBinding.connected')).toBeInTheDocument();
    expect(screen.queryByText('workspaceBinding.updateCheck.action')).not.toBeInTheDocument();
    expect(screen.queryByText('workspaceBinding.ingestionMode')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'workspaceBinding.remove' }));
    expect(mocks.deleteBinding).toHaveBeenCalledWith('binding-1');
  });

  it('does not disconnect a binding shared with another scope', () => {
    render(<WorkspaceBindingCard programId='program-1' scopeId='scope-1' binding={{ id: 'binding-1', programId: 'program-1', workspaceId: 'workspace-1', visibility: 'multi_scope', scopeIds: ['scope-1', 'scope-2'], enabled: true, createdAt: '2026-08-14T00:00:00.000Z', updatedAt: '2026-08-14T00:00:00.000Z' }} />);

    expect(screen.getByText('workspaceBinding.sharedConnection')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'workspaceBinding.remove' })).not.toBeInTheDocument();
  });
});
