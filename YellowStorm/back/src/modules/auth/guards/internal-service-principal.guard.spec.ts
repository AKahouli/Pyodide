import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { internalServicePrincipalGuardFor, InternalServicePrincipal, assertUnambiguousSecurityHeaders,
  AdkRootRuntimeServiceGuard, AdkPlaybookArtifactServiceGuard, AdkRuntimeMcpRenewalGuard,
  AppRuntimeServiceGuard, SemanticRuntimeServiceGuard } from './internal-service-principal.guard';

function ctx(headers: Record<string, string | undefined>): ExecutionContext {
  const request = { headers: Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])) };
  return { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;
}

describe('InternalServicePrincipalGuard runtime authority', () => {
  const token = 'synthetic-runtime-secret-00000001';
  const principals = [
    [AppRuntimeServiceGuard, 'app-runtime', 'APP_RUNTIME_BIND_TOKEN'],
    [AdkRuntimeMcpRenewalGuard, 'adk-runtime', 'ADK_RUNTIME_MCP_RENEWAL_TOKEN'],
    [SemanticRuntimeServiceGuard, 'semantic-runtime', 'SEMANTIC_RUNTIME_BACKEND_SERVICE_TOKEN'],
    [AdkRootRuntimeServiceGuard, 'adk-root-runtime', 'ADK_ROOT_RUNTIME_SERVICE_TOKEN'],
    [AdkPlaybookArtifactServiceGuard, 'adk-playbook-artifact', 'ADK_PLAYBOOK_ARTIFACT_SERVICE_TOKEN'],
  ] as const;
  const retired = ['mcp-agent', 'mcp-playbook', 'semantic-model-mcp'];
  const makeGuard = (principal: InternalServicePrincipal, env: Record<string, string | undefined>) =>
    new (internalServicePrincipalGuardFor(principal))({ get: (key: string) => env[key] } as ConfigService);
  const headers = (principal: string, secret = token) => ({
    'x-yellowstorm-service-principal': principal, 'x-yellowstorm-service-token': secret,
  });

  it.each(principals)('keeps %s scoped to its own runtime credential', (Guard, principal, key) => {
    const guard = new Guard({ get: (name: string) => name === key ? token : undefined } as ConfigService);
    expect(guard.canActivate(ctx(headers(principal)))).toBe(true);
    for (const foreign of [...principals.map(([, name]) => name), ...retired].filter(name => name !== principal)) {
      expect(() => guard.canActivate(ctx(headers(foreign)))).toThrow(UnauthorizedException);
    }
    expect(() => guard.canActivate(ctx(headers(principal, 'wrong-secret')))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx({ 'x-internal-token': token }))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
  });

  it.each(principals)('fails closed when %s has no credential, even with generic or retired secrets', (_Guard, principal) => {
    const guard = makeGuard(principal, { INTERNAL_SERVICE_SECRET: token,
      AGENT_MCP_BACKEND_SERVICE_TOKEN: token, PLAYBOOK_MCP_BACKEND_SERVICE_TOKEN: token,
      SEMANTIC_MODEL_MCP_SERVICE_TOKEN: token });
    expect(() => guard.canActivate(ctx(headers(principal)))).toThrow(/not configured/);
  });

  it('ignores retired deployment secrets when validating active renewal authority', () => {
    const guard = makeGuard('adk-runtime', { ADK_RUNTIME_MCP_RENEWAL_TOKEN: token,
      AGENT_MCP_BACKEND_SERVICE_TOKEN: token, PLAYBOOK_MCP_BACKEND_SERVICE_TOKEN: ' ',
      SEMANTIC_MODEL_MCP_SERVICE_TOKEN: 'short', NODE_ENV: 'production' });
    expect(guard.canActivate(ctx(headers('adk-runtime')))).toBe(true);
  });

  it.each([' ', 'short', ` ${token}`])('rejects invalid production runtime credentials without leaking values', secret => {
    expect(() => makeGuard('adk-runtime', { ADK_RUNTIME_MCP_RENEWAL_TOKEN: secret, NODE_ENV: 'production' })
      .canActivate(ctx(headers('adk-runtime', secret)))).toThrow('Invalid internal service credential configuration');
  });

  it.each(['INTERNAL_SERVICE_SECRET', ...principals.filter(([, principal]) => principal !== 'adk-runtime').map(([, , key]) => key)])
  ('rejects equal active credential %s without leaking values', key => {
    expect(() => makeGuard('adk-runtime', { ADK_RUNTIME_MCP_RENEWAL_TOKEN: token, [key]: token })
      .canActivate(ctx(headers('adk-runtime')))).toThrow('Invalid internal service credential configuration');
  });

  it.each(['x-yellowstorm-service-principal', 'x-yellowstorm-service-token', 'x-yellowstorm-mcp-assertion',
    'x-yellowstorm-user-id', 'authorization', 'x-correlation-id'])('rejects ambiguous %s headers including raw duplicates', name => {
    for (const value of [['one', 'two'], 'one,two']) {
      expect(() => assertUnambiguousSecurityHeaders({ headers: { [name]: value } })).toThrow(/Ambiguous/);
    }
    expect(() => assertUnambiguousSecurityHeaders({ headers: { [name]: 'one' },
      rawHeaders: [name, 'one', name.toUpperCase(), 'two'] })).toThrow(/Ambiguous/);
  });
});
