import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showError } from '@/lib/notifications';
import { GovernancePage } from './GovernancePage';

const mocks = vi.hoisted(() => ({
  createProgram: vi.fn(),
  createScope: vi.fn(),
  deleteProgram: vi.fn(),
  setSelectedProgramId: vi.fn(),
  setSelectedScopeId: vi.fn(),
}));

vi.mock('@/lib/notifications', () => ({ showError: vi.fn() }));
vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key === 'programs.copySuffix' ? ' (copy)' : key }),
}));
vi.mock('@/modules/governance', () => ({
  useCreateGovernanceProgram: () => ({ mutate: mocks.createProgram, isPending: false }),
  useCreateGovernanceScope: () => ({ mutate: mocks.createScope, isPending: false }),
  useDeleteGovernanceProgram: () => ({ mutate: mocks.deleteProgram, isPending: false }),
  useGovernancePrograms: () => ({ data: [{ id: 'program-1', name: 'Program', description: 'Description', domain: 'public', defaultLanguage: 'fr', status: 'published', createdAt: '', updatedAt: '' }] }),
  useGovernanceUiStore: (selector: (state: { selectedProgramId: string; selectedScopeId: string | null; setSelectedProgramId: typeof mocks.setSelectedProgramId; setSelectedScopeId: typeof mocks.setSelectedScopeId }) => unknown) => selector({ selectedProgramId: 'program-1', selectedScopeId: 'scope-1', setSelectedProgramId: mocks.setSelectedProgramId, setSelectedScopeId: mocks.setSelectedScopeId }),
}));
vi.mock('./GovernanceCockpit', () => ({ GovernanceCockpit: () => <div /> }));
vi.mock('./GovernanceScopeLifecycleShell', () => ({ GovernanceScopeLifecycleShell: () => <div /> }));

describe('GovernancePage program cloning', () => {
  beforeEach(() => vi.clearAllMocks());

  it('clones the selected program, selects the clone, and reports failures', async () => {
    render(<GovernancePage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'programs.actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'programs.clone' }));

    const [payload, callbacks] = mocks.createProgram.mock.calls[0];
    expect(payload).toEqual({ name: 'Program (copy)', description: 'Description', domain: 'public', defaultLanguage: 'fr' });

    callbacks.onSuccess({ id: 'program-copy' });
    expect(mocks.setSelectedProgramId).toHaveBeenCalledWith('program-copy');
    expect(mocks.setSelectedScopeId).toHaveBeenCalledWith(null);

    callbacks.onError(new Error('Request failed'));
    expect(showError).toHaveBeenCalledWith('programs.cloneError', expect.objectContaining({ description: 'Request failed' }));
  });
});
