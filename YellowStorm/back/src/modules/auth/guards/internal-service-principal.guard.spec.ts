import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { internalServicePrincipalGuardFor, InternalServicePrincipal, assertUnambiguousSecurityHeaders,
  AdkRootRuntimeServiceGuard, AdkPlaybookArtifactServiceGuard } from './internal-service-principal.guard';

function ctx(headers: Record<string, string | undefined>): ExecutionContext {
  const norm = Object.fromEntries(
    Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const req: { headers: Record<string, string | undefined> } = { headers: norm };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('InternalServicePrincipalGuard (WP07.2/WP07.3)', () => {
  const semanticToken = 'semantic-mcp-principal-secret-0001';
  const bindToken = 'app-runtime-bind-secret-00000001';

  const makeGuard = (principal: InternalServicePrincipal, env: Record<string, string | undefined>) => {
    const config = {
      get: jest.fn((key: string) => env[key]),
    } as unknown as ConfigService;
    return new (internalServicePrincipalGuardFor(principal))(config);
  };

  it('authenticates the semantic-model-mcp principal with its own scoped secret', () => {
    const guard = makeGuard('semantic-model-mcp', { SEMANTIC_MODEL_MCP_SERVICE_TOKEN: semanticToken });
    expect(guard.canActivate(ctx({
      'x-yellowstorm-service-principal': 'semantic-model-mcp',
      'x-yellowstorm-service-token': semanticToken,
    }))).toBe(true);
  });

  it('rejects the app-runtime bind token on a semantic endpoint group (trust-domain crossing, WP07.3)', () => {
    const guard = makeGuard('semantic-model-mcp', { SEMANTIC_MODEL_MCP_SERVICE_TOKEN: semanticToken });
    expect(() => guard.canActivate(ctx({
      'x-yellowstorm-service-principal': 'semantic-model-mcp',
      'x-yellowstorm-service-token': bindToken,
    }))).toThrow(UnauthorizedException);
  });

  it('rejects a valid foreign principal declaration against a different endpoint group', () => {
    const guard = makeGuard('semantic-model-mcp', { SEMANTIC_MODEL_MCP_SERVICE_TOKEN: semanticToken });
    expect(() => guard.canActivate(ctx({
      'x-yellowstorm-service-principal': 'app-runtime',
      'x-yellowstorm-service-token': semanticToken,
    }))).toThrow(UnauthorizedException);
  });

  it('authenticates the app-runtime principal with APP_RUNTIME_BIND_TOKEN only on the app-runtime group', () => {
    const guard = makeGuard('app-runtime', { APP_RUNTIME_BIND_TOKEN: bindToken });
    expect(guard.canActivate(ctx({
      'x-yellowstorm-service-principal': 'app-runtime',
      'x-yellowstorm-service-token': bindToken,
    }))).toBe(true);
  });

  it('fail-closes when the principal secret is unset (WP07.6)', () => {
    const guard = makeGuard('semantic-model-mcp', {});
    expect(() => guard.canActivate(ctx({
      'x-yellowstorm-service-principal': 'semantic-model-mcp',
      'x-yellowstorm-service-token': semanticToken,
    }))).toThrow(/not configured/);
  });

  it('limits renewal to the dedicated adk-runtime principal and secret', () => {
    const guard = makeGuard('adk-runtime', { ADK_RUNTIME_MCP_RENEWAL_TOKEN: 'renewal-secret-0001' });
    expect(guard.canActivate(ctx({ 'x-yellowstorm-service-principal': 'adk-runtime',
      'x-yellowstorm-service-token': 'renewal-secret-0001' }))).toBe(true);
    for (const principal of ['semantic-model-mcp', 'app-runtime']) {
      expect(() => guard.canActivate(ctx({ 'x-yellowstorm-service-principal': principal,
        'x-yellowstorm-service-token': 'renewal-secret-0001' }))).toThrow(UnauthorizedException);
    }
    expect(() => guard.canActivate(ctx({ 'x-yellowstorm-service-principal': 'adk-runtime',
      'x-yellowstorm-service-token': semanticToken }))).toThrow(UnauthorizedException);
  });

  it('rejects missing headers and wrong tokens', () => {
    const guard = makeGuard('semantic-model-mcp', { SEMANTIC_MODEL_MCP_SERVICE_TOKEN: semanticToken });
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx({
      'x-yellowstorm-service-principal': 'semantic-model-mcp',
      'x-yellowstorm-service-token': 'wrong-token-value!!!!!!!',
    }))).toThrow(UnauthorizedException);
  });

  it.each([
    [AdkRootRuntimeServiceGuard, 'adk-root-runtime', 'ADK_ROOT_RUNTIME_SERVICE_TOKEN'],
    [AdkPlaybookArtifactServiceGuard, 'adk-playbook-artifact', 'ADK_PLAYBOOK_ARTIFACT_SERVICE_TOKEN'],
  ] as const)('exports the dedicated %s guard without generic credential fallback', (Guard, principal, key) => {
    const config = { get: (name: string) => name === key ? semanticToken : undefined } as unknown as ConfigService;
    const guard = new Guard(config);
    expect(guard.canActivate(ctx({ 'x-yellowstorm-service-principal': principal,
      'x-yellowstorm-service-token': semanticToken }))).toBe(true);
    expect(() => guard.canActivate(ctx({ 'x-internal-token': semanticToken }))).toThrow();
  });

  it.each([
    ['mcp-agent', 'AGENT_MCP_BACKEND_SERVICE_TOKEN'],
    ['mcp-playbook', 'PLAYBOOK_MCP_BACKEND_SERVICE_TOKEN'],
    ['semantic-runtime', 'SEMANTIC_RUNTIME_BACKEND_SERVICE_TOKEN'],
    ['adk-root-runtime', 'ADK_ROOT_RUNTIME_SERVICE_TOKEN'],
    ['adk-playbook-artifact', 'ADK_PLAYBOOK_ARTIFACT_SERVICE_TOKEN'],
  ] as const)('isolates %s from generic and foreign credentials', (principal, key) => {
    const guard = makeGuard(principal, { [key]: semanticToken, INTERNAL_SERVICE_SECRET: 'generic-secret' });
    expect(guard.canActivate(ctx({ 'x-yellowstorm-service-principal': principal,
      'x-yellowstorm-service-token': semanticToken }))).toBe(true);
    expect(() => guard.canActivate(ctx({ 'x-internal-token': 'generic-secret' }))).toThrow();
    expect(() => guard.canActivate(ctx({ 'x-yellowstorm-service-principal': principal,
      'x-yellowstorm-service-token': 'generic-secret' }))).toThrow();
    expect(() => guard.canActivate(ctx({ 'x-yellowstorm-service-principal': 'semantic-model-mcp',
      'x-yellowstorm-service-token': semanticToken }))).toThrow();
  });

  it.each([
    { SEMANTIC_MODEL_MCP_SERVICE_TOKEN: ' ' },
    { SEMANTIC_MODEL_MCP_SERVICE_TOKEN: 'short', NODE_ENV: 'production' },
    { SEMANTIC_MODEL_MCP_SERVICE_TOKEN: semanticToken, INTERNAL_SERVICE_SECRET: semanticToken },
    { SEMANTIC_MODEL_MCP_SERVICE_TOKEN: semanticToken, AGENT_MCP_BACKEND_SERVICE_TOKEN: semanticToken },
    { SEMANTIC_MODEL_MCP_SERVICE_TOKEN: semanticToken, SEMANTIC_RUNTIME_BACKEND_SERVICE_TOKEN: semanticToken },
    { SEMANTIC_MODEL_MCP_SERVICE_TOKEN: semanticToken, ADK_ROOT_RUNTIME_SERVICE_TOKEN: semanticToken },
    { SEMANTIC_MODEL_MCP_SERVICE_TOKEN: semanticToken, ADK_PLAYBOOK_ARTIFACT_SERVICE_TOKEN: semanticToken },
  ])('rejects invalid credential configuration without leaking values', (env) => {
    expect(() => makeGuard('semantic-model-mcp', env).canActivate(ctx({
      'x-yellowstorm-service-principal': 'semantic-model-mcp', 'x-yellowstorm-service-token': semanticToken,
    }))).toThrow(/credential configuration/);
  });

  it.each(['x-yellowstorm-service-principal', 'x-yellowstorm-service-token',
    'x-yellowstorm-mcp-assertion', 'x-yellowstorm-user-id', 'authorization'])('rejects ambiguous %s headers including raw duplicates', (name) => {
    for (const value of [['one', 'two'], 'one,two']) {
      expect(() => assertUnambiguousSecurityHeaders({ headers: { [name]: value } })).toThrow(/Ambiguous/);
    }
    expect(() => assertUnambiguousSecurityHeaders({ headers: { [name]: 'one' },
      rawHeaders: [name, 'one', name.toUpperCase(), 'two'] })).toThrow(/Ambiguous/);
  });
});
