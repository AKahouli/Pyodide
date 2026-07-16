import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showError } from '@/lib/notifications';
import { GovernanceCockpit } from './GovernanceCockpit';

const mocks = vi.hoisted(() => ({ createScope: vi.fn(), deleteScope: vi.fn() }));

vi.mock('@/lib/notifications', () => ({ showError: vi.fn() }));
vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key === 'cockpit.scopes.copySuffix' ? ' (copy)' : key }),
}));
vi.mock('@/modules/governance', () => ({
  useCreateGovernanceScope: () => ({ mutate: mocks.createScope, isPending: false }),
  useDeleteGovernanceScope: () => ({ mutate: mocks.deleteScope, isPending: false }),
  useGovernanceScopes: () => ({ data: [{ id: 'scope-1', programId: 'program-1', parentScopeId: 'parent-1', agentIds: ['agent-1'], name: 'Scope', type: 'municipality', status: 'active', createdAt: '', updatedAt: '' }] }),
  useGovernanceScopeOverviews: () => ({ byScopeId: {} }),
}));
vi.mock('../useGovernanceCheckLabel', () => ({ useGovernanceCheckLabel: () => ({ translateBlocker: (_key: string, fallback: string) => fallback }) }));

describe('GovernanceCockpit scope cloning', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clones a scope without opening it and reports failures', () => {
    const onSelectScope = vi.fn();
    render(<GovernanceCockpit programId='program-1' onSelectScope={onSelectScope} onCreateScope={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'cockpit.scopes.clone' }));

    const [payload, callbacks] = mocks.createScope.mock.calls[0];
    expect(payload).toEqual({ name: 'Scope (copy)', type: 'municipality', parentScopeId: 'parent-1', agentIds: ['agent-1'] });
    expect(onSelectScope).not.toHaveBeenCalled();

    callbacks.onError(new Error('Request failed'));
    expect(showError).toHaveBeenCalledWith('cockpit.scopes.cloneError', expect.objectContaining({ description: 'Request failed' }));
  });
});
