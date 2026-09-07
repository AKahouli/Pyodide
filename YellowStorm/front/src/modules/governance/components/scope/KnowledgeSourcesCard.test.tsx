import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showError, showSuccess } from '@/lib/notifications';
import { KnowledgeSourcesCard } from './KnowledgeSourcesCard';
import type { GovernanceScope } from '../../types';

const mocks = vi.hoisted(() => ({ updateScope: vi.fn() }));

vi.mock('@/lib/notifications', () => ({ showError: vi.fn(), showSuccess: vi.fn() }));
vi.mock('@/modules/localization', () => ({
  useModuleTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/modules/governance', () => ({
  useUpdateGovernanceScope: () => ({ mutate: mocks.updateScope, isPending: false }),
}));

function buildScope(knowledge?: Partial<GovernanceScope['knowledge']>): GovernanceScope {
  return {
    id: 'scope-1',
    programId: 'program-1',
    agentIds: [],
    name: 'Credit scope',
    type: 'custom',
    status: 'active',
    knowledge: { sourceMode: 'llm_only', webSourcesEnabled: false, webAllowedDomains: [], webBlockedDomains: [], ...knowledge },
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('KnowledgeSourcesCard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reflects the saved knowledge settings', () => {
    render(<KnowledgeSourcesCard programId='program-1' scope={buildScope({ sourceMode: 'workspaces_only', webSourcesEnabled: true, webAllowedDomains: ['docs.example.com', 'repo.example.org'] })} />);

    expect(screen.getByRole('radio', { name: 'scopeShell.knowledge.sources.workspacesOnly' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'scopeShell.knowledge.sources.llmOnly' })).not.toBeChecked();
    expect(screen.getByLabelText('scopeShell.knowledge.sources.webAllowed')).toHaveValue('docs.example.com, repo.example.org');
    expect(screen.getByRole('button', { name: 'scopeShell.settings.save' })).toBeDisabled();
  });

  it('normalizes domains and saves the payload', async () => {
    const user = userEvent.setup();
    render(<KnowledgeSourcesCard programId='program-1' scope={buildScope({ webSourcesEnabled: true, webAllowedDomains: [] })} />);

    const allowed = screen.getByLabelText('scopeShell.knowledge.sources.webAllowed');
    await user.type(allowed, ' https://Docs.Example.com/guide, repo.example.org');
    await user.click(screen.getByRole('button', { name: 'scopeShell.settings.save' }));

    expect(mocks.updateScope).toHaveBeenCalledTimes(1);
    expect(mocks.updateScope.mock.calls[0][0]).toEqual({
      knowledge: {
        sourceMode: 'llm_only',
        webSourcesEnabled: true,
        webAllowedDomains: ['docs.example.com', 'repo.example.org'],
        webBlockedDomains: [],
      },
    });
    mocks.updateScope.mock.calls[0][1].onSuccess();
    expect(showSuccess).toHaveBeenCalledWith('scopeShell.knowledge.sources.saved');
  });

  it('blocks saving when a domain entry is invalid', async () => {
    const user = userEvent.setup();
    render(<KnowledgeSourcesCard programId='program-1' scope={buildScope({ webSourcesEnabled: true })} />);

    await user.type(screen.getByLabelText('scopeShell.knowledge.sources.webBlocked'), 'not a domain');
    expect(screen.getByRole('alert')).toHaveTextContent('scopeShell.knowledge.sources.invalidDomain');
    expect(screen.getByRole('button', { name: 'scopeShell.settings.save' })).toBeDisabled();
    expect(mocks.updateScope).not.toHaveBeenCalled();
  });

  it('hides the domain lists until web sources are enabled and hints that empty means all', async () => {
    const user = userEvent.setup();
    render(<KnowledgeSourcesCard programId='program-1' scope={buildScope()} />);

    expect(screen.queryByLabelText('scopeShell.knowledge.sources.webAllowed')).not.toBeInTheDocument();

    await user.click(screen.getByRole('switch', { name: 'scopeShell.knowledge.sources.webSources' }));

    expect(screen.getByLabelText('scopeShell.knowledge.sources.webAllowed')).toBeInTheDocument();
    expect(screen.getByLabelText('scopeShell.knowledge.sources.webBlocked')).toBeInTheDocument();
    expect(screen.getByText('scopeShell.knowledge.sources.webAnyDomain')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'scopeShell.settings.save' }));

    expect(mocks.updateScope.mock.calls[0][0].knowledge.webAllowedDomains).toEqual([]);
    expect(mocks.updateScope.mock.calls[0][0].knowledge.webBlockedDomains).toEqual([]);
  });

  it('reports save failures', async () => {
    const user = userEvent.setup();
    render(<KnowledgeSourcesCard programId='program-1' scope={buildScope({ webSourcesEnabled: true })} />);

    await user.type(screen.getByLabelText('scopeShell.knowledge.sources.webAllowed'), 'docs.example.com');
    await user.click(screen.getByRole('button', { name: 'scopeShell.settings.save' }));

    mocks.updateScope.mock.calls[0][1].onError(new Error('Denied'));
    expect(showError).toHaveBeenCalledWith('scopeShell.knowledge.sources.saveError', expect.objectContaining({ description: 'Denied' }));
  });
});
