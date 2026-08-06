import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GovernanceScopeLifecycleShell } from './GovernanceScopeLifecycleShell';

const mocks = vi.hoisted(() => ({
  selectedScopeId: 'scope-1' as string | null,
  setSelectedScopeId: vi.fn(),
  scopeOverview: vi.fn(),
}));

vi.mock('@/modules/governance', () => ({
  useGovernanceMemberships: () => ({ data: [], isLoading: false }),
  useGovernanceMetrics: () => ({ data: [] }),
  useGovernanceScopeOverview: (programId: string | null, scopeId: string | null) => {
    mocks.scopeOverview(programId, scopeId);
    return { data: undefined };
  },
  useGovernanceScopes: () => ({ data: [{ id: 'scope-1' }, { id: 'scope-2' }] }),
  useGovernanceUiStore: (selector: (state: { selectedScopeId: string | null; setSelectedScopeId: typeof mocks.setSelectedScopeId }) => unknown) => selector({ selectedScopeId: mocks.selectedScopeId, setSelectedScopeId: mocks.setSelectedScopeId }),
}));

vi.mock('./GovernanceScopeWorkspace', () => ({ GovernanceScopeWorkspace: () => <div>workspace</div> }));
vi.mock('./GovernanceReadinessPanel', () => ({ GovernanceReadinessPanel: () => <aside>readiness</aside> }));

describe('GovernanceScopeLifecycleShell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectedScopeId = 'scope-1';
  });

  it('requests an overview only for the selected scope', () => {
    const { rerender } = render(<GovernanceScopeLifecycleShell programId='program-1' />);
    expect(mocks.scopeOverview).toHaveBeenLastCalledWith('program-1', 'scope-1');

    mocks.selectedScopeId = 'scope-2';
    rerender(<GovernanceScopeLifecycleShell programId='program-1' />);
    expect(mocks.scopeOverview).toHaveBeenLastCalledWith('program-1', 'scope-2');
  });
});
