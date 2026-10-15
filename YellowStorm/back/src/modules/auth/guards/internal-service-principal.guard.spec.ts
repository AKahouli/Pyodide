import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { internalServicePrincipalGuardFor } from './internal-service-principal.guard';

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

  const makeGuard = (principal: 'semantic-model-mcp' | 'app-runtime', env: Record<string, string>) => {
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

  it('rejects missing headers and wrong tokens', () => {
    const guard = makeGuard('semantic-model-mcp', { SEMANTIC_MODEL_MCP_SERVICE_TOKEN: semanticToken });
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx({
      'x-yellowstorm-service-principal': 'semantic-model-mcp',
      'x-yellowstorm-service-token': 'wrong-token-value!!!!!!!',
    }))).toThrow(UnauthorizedException);
  });
});
