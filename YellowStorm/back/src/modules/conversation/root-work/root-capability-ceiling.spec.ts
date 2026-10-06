import type { IGrpcAgent } from '../../agent/interfaces/agent.interface';
import { freezeRootCapabilityCeiling, scopeCandidateToFrozenCeiling } from './root-capability-ceiling';

describe('frozen root capability ceiling', () => {
  const root = {
    tools: [{ name: 'search', params: { scope: 'allowed' } }],
    brain_context: [{ workspace_id: 'workspace' }], skills: [{ id: 'skill', instruction: 'original' }],
    connector_bindings: [{ connector_id: 'connector', server_url: 'https://approved.example',
      auth_headers: { Authorization: 'root-credential' }, auth_env: { TOKEN: 'root-credential' },
      fixed_params: { workspace_id: 'workspace' },
      actions: [{ action_key: 'read', method: 'GET', path: '/read' }] }],
  } as unknown as IGrpcAgent;
  const candidate = (): IGrpcAgent => JSON.parse(JSON.stringify(root));

  it('freezes hashes instead of credentials and sensitive definitions', () => {
    const frozen = JSON.stringify(freezeRootCapabilityCeiling(root));
    expect(frozen).not.toContain('root-credential');
    expect(frozen).not.toContain('original');
    expect(frozen).not.toContain('approved.example');
  });

  it('refreshes binding credentials while retaining enforced mandatory constraints', () => {
    const worker = candidate();
    const binding = worker.connector_bindings![0];
    binding.auth_headers = { Authorization: 'refreshed-worker-credential' };
    binding.fixed_params = { workspace_id: 'workspace', folder_id: 'narrower' };
    const scoped = scopeCandidateToFrozenCeiling(worker, freezeRootCapabilityCeiling(root));
    expect(scoped.connector_bindings).toEqual([{ ...binding, enforced_params: { workspace_id: 'workspace' } }]);
  });

  it.each(['action', 'server', 'constraint'])('denies changed %s semantics even with the same action key', (changed) => {
    const worker = candidate();
    const binding = worker.connector_bindings![0];
    if (changed === 'action') binding.actions = [{ action_key: 'read', method: 'POST', path: '/execute' }];
    if (changed === 'server') binding.server_url = 'https://unapproved.example';
    if (changed === 'constraint') binding.fixed_params = {};
    expect(scopeCandidateToFrozenCeiling(worker, freezeRootCapabilityCeiling(root)).connector_bindings).toEqual([]);
  });

  it('denies changed tool and skill definitions with identical identifiers', () => {
    const worker = candidate();
    worker.tools = [{ name: 'search', params: { scope: 'all' } }] as any;
    worker.skills = [{ id: 'skill', instruction: 'widened' }];
    const scoped = scopeCandidateToFrozenCeiling(worker, freezeRootCapabilityCeiling(root));
    expect(scoped.tools).toEqual([]);
    expect(scoped.skills).toEqual([]);
  });
  it('refreshes acting-user tool credentials without changing the frozen definition', () => {
    const first = candidate();
    first.tools = [{ name: 'search', accessToken: 'old-user-credential', scope: 'own' }];
    const refreshed = { ...first, tools: [{ name: 'search', accessToken: 'fresh-user-credential', scope: 'own' }] };
    expect(freezeRootCapabilityCeiling(refreshed)).toEqual(freezeRootCapabilityCeiling(first));
    expect(scopeCandidateToFrozenCeiling(refreshed, freezeRootCapabilityCeiling(first)).tools).toEqual(refreshed.tools);
    refreshed.tools[0].scope = 'all';
    expect(scopeCandidateToFrozenCeiling(refreshed, freezeRootCapabilityCeiling(first)).tools).toEqual([]);
  });
});
