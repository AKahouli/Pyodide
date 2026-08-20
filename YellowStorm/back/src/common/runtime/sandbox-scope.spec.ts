import {
  CODE_INTERPRETER_CONNECTOR_SLUG,
  SandboxRuntimeContext,
  buildSandboxScopeHeaders,
  applySandboxScopeHeaders,
} from './sandbox-scope';

const convCtx: SandboxRuntimeContext = {
  userId: 'user-1',
  scopeType: 'conversation',
  scopeId: 'conversation:sess-1',
  laneId: 'main',
};

describe('buildSandboxScopeHeaders', () => {
  it('emits exactly the required keys for a conversation context (no optional keys)', () => {
    expect(buildSandboxScopeHeaders(convCtx)).toEqual({
      'x-user-id': 'user-1',
      'x-sandbox-scope-type': 'conversation',
      'x-sandbox-scope-id': 'conversation:sess-1',
      'x-sandbox-lane-id': 'main',
    });
  });

  it('emits x-node-id and stringified x-node-iteration when present', () => {
    const headers = buildSandboxScopeHeaders({
      ...convCtx,
      scopeType: 'playbook',
      scopeId: 'playbook:exec-9',
      nodeId: 'node-A',
      iteration: 0,
    });
    expect(headers['x-node-id']).toBe('node-A');
    expect(headers['x-node-iteration']).toBe('0');
  });
});

describe('applySandboxScopeHeaders', () => {
  const slugOf = (b: { connector_slug?: string }) => b.connector_slug;

  it('stamps only the code-interpreter binding and leaves others byte-identical', () => {
    const other = { connector_slug: 'gmail', auth_headers: { authorization: 'Bearer x' } };
    const ci = { connector_slug: CODE_INTERPRETER_CONNECTOR_SLUG, auth_headers: {} as Record<string, string> };
    const before = JSON.stringify(other);

    applySandboxScopeHeaders([other, ci], convCtx, slugOf);

    expect(JSON.stringify(other)).toBe(before);
    expect(ci.auth_headers['x-sandbox-scope-id']).toBe('conversation:sess-1');
  });

  it('preserves existing auth_headers keys; scope keys win on collision', () => {
    const ci = {
      connector_slug: CODE_INTERPRETER_CONNECTOR_SLUG,
      auth_headers: { authorization: 'Bearer x', 'x-user-id': 'STALE' } as Record<string, string>,
    };
    applySandboxScopeHeaders([ci], convCtx, slugOf);
    expect(ci.auth_headers.authorization).toBe('Bearer x');
    expect(ci.auth_headers['x-user-id']).toBe('user-1');
  });

  it('initializes auth_headers when a matching binding has none', () => {
    const ci: { connector_slug: string; auth_headers?: Record<string, string> } = {
      connector_slug: CODE_INTERPRETER_CONNECTOR_SLUG,
    };
    applySandboxScopeHeaders([ci], convCtx, slugOf);
    expect(ci.auth_headers?.['x-sandbox-scope-type']).toBe('conversation');
  });
});
