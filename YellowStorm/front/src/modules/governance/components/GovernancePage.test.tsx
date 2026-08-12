import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showError } from '@/lib/notifications';
import { GovernancePage } from './GovernancePage';

const mocks = vi.hoisted(() => ({
  createProgram: vi.fn(),
  updateProgram: vi.fn(),
  createScope: vi.fn(),
  deleteProgram: vi.fn(),
  setSelectedProgramId: vi.fn(),
  setSelectedScopeId: vi.fn(),
  selectedScopeId: 'scope-1' as string | null,
  programs: [{ id: 'program-1', name: 'Program', description: 'Description', domain: 'public', defaultLanguage: 'fr', status: 'published', createdAt: '', updatedAt: '' }],
}));

vi.mock('@/lib/notifications', () => ({ showError: vi.fn() }));
vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key === 'programs.copySuffix' ? ' (copy)' : key }),
}));
vi.mock('@/modules/governance', () => ({
  useCreateGovernanceProgram: () => ({ mutate: mocks.createProgram, isPending: false }),
  useCreateGovernanceScope: () => ({ mutate: mocks.createScope, isPending: false }),
  useDeleteGovernanceProgram: () => ({ mutate: mocks.deleteProgram, isPending: false }),
  useUpdateGovernanceProgram: () => ({ mutate: mocks.updateProgram, isPending: false }),
  useGovernancePrograms: () => ({ data: mocks.programs }),
  useGovernanceUiStore: (selector: (state: { selectedProgramId: string; selectedScopeId: string | null; setSelectedProgramId: typeof mocks.setSelectedProgramId; setSelectedScopeId: typeof mocks.setSelectedScopeId }) => unknown) => selector({ selectedProgramId: 'program-1', selectedScopeId: mocks.selectedScopeId, setSelectedProgramId: mocks.setSelectedProgramId, setSelectedScopeId: mocks.setSelectedScopeId }),
}));
vi.mock('./GovernanceCockpit', () => ({ GovernanceCockpit: ({ onCreateScope }: { onCreateScope: () => void }) => <button type='button' onClick={onCreateScope}>cockpit.scopes.create</button> }));
vi.mock('./GovernanceScopeLifecycleShell', () => ({
  GovernanceScopeLifecycleShell: ({ initialTab, onActiveTabChange }: { initialTab: string; onActiveTabChange: (tab: 'testPublish') => void }) => (
    <button type='button' onClick={() => onActiveTabChange('testPublish')}>lifecycle:{initialTab}</button>
  ),
}));

describe('GovernancePage program cloning', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.selectedScopeId = 'scope-1';
    mocks.programs = [{ id: 'program-1', name: 'Program', description: 'Description', domain: 'public', defaultLanguage: 'fr', status: 'published', createdAt: '', updatedAt: '' }];
  });

  it('renames the selected program from the contextual menu and reports failures', async () => {
    render(<GovernancePage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'programs.actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'programs.rename' }));
    const input = screen.getByRole('textbox', { name: 'programs.nameLabel' });
    await user.clear(input);
    await user.type(input, 'Renamed program');
    await user.click(screen.getByRole('button', { name: 'programs.rename' }));

    const [payload, callbacks] = mocks.updateProgram.mock.calls[0];
    expect(payload).toEqual({ name: 'Renamed program' });

    callbacks.onError(new Error('Rename failed'));
    expect(showError).toHaveBeenCalledWith('programs.renameError', expect.objectContaining({ description: 'Rename failed' }));
  });

  it('keeps program creation available from the contextual menu when the list is empty', async () => {
    mocks.selectedScopeId = null;
    mocks.programs = [];
    const { container } = render(<GovernancePage />);

    expect(container.querySelector('main')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'programs.create' })).not.toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'programs.actions' }));
    expect(await screen.findByRole('menuitem', { name: 'programs.create' })).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'programs.rename' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('menuitem', { name: 'programs.create' }));
    expect(screen.getByRole('dialog', { name: 'programs.create' })).toBeInTheDocument();
  });

  it('clones the selected program, selects the clone, and reports failures', async () => {
    render(<GovernancePage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'programs.actions' }));
    await user.click(await screen.findByRole('menuitem', { name: 'programs.clone' }));

    const [payload, callbacks] = mocks.createProgram.mock.calls[0];
    expect(payload).toEqual({ name: 'Program (copy)', description: 'Description', domain: 'public', defaultLanguage: 'fr' });

    act(() => callbacks.onSuccess({ id: 'program-copy' }));
    expect(mocks.setSelectedProgramId).toHaveBeenCalledWith('program-copy');
    expect(mocks.setSelectedScopeId).toHaveBeenCalledWith(null);

    callbacks.onError(new Error('Request failed'));
    expect(showError).toHaveBeenCalledWith('programs.cloneError', expect.objectContaining({ description: 'Request failed' }));
  });

  it('asks for a scope name before creating a scope', async () => {
    mocks.selectedScopeId = null;
    render(<GovernancePage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'cockpit.scopes.create' }));
    await user.type(screen.getByRole('textbox', { name: 'scopes.nameLabel' }), 'Service information');
    await user.click(screen.getByRole('button', { name: 'scopes.create' }));

    const [payload, callbacks] = mocks.createScope.mock.calls[0];
    expect(payload).toEqual({ name: 'Service information', type: 'municipality' });

    act(() => callbacks.onSuccess({ id: 'scope-new' }));
    expect(mocks.setSelectedScopeId).toHaveBeenCalledWith('scope-new');
  });

  it('preserves the active lifecycle tab across scope-shell remounts', async () => {
    render(<GovernancePage />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'lifecycle:overview' }));

    expect(screen.getByRole('button', { name: 'lifecycle:testPublish' })).toBeInTheDocument();
  });
});
