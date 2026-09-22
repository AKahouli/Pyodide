import { Reflector } from '@nestjs/core';
import { createHash } from 'crypto';
import { ForbiddenException, UnauthorizedException } from '@modules/exceptions';
import { WidgetTokenGuard } from './widget-token.guard';
import { InMemoryWidgetTokenStore } from '../persistence/widget.store.fake';

const RAW_TOKEN = 'plain-token';
const TOKEN_HASH = createHash('sha256').update(RAW_TOKEN).digest('hex');

function createExecutionContext(path: string) {
  const request = {
    path,
    headers: { authorization: `Bearer ${RAW_TOKEN}`, origin: 'https://example.test' },
    query: {},
  };

  return {
    request,
    context: {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any,
  };
}

function seededTokenStore(over: Partial<Parameters<InMemoryWidgetTokenStore['seed']>[0]> = {}) {
  const store = new InMemoryWidgetTokenStore();
  store.seed({ tokenHash: TOKEN_HASH, agentId: 'agent-1', ...over });
  return store;
}

function createGuard(
  mode: 'embed' | 'rest' | undefined,
  deploymentSettings: { embedEnabled?: boolean; restEnabled?: boolean },
  tokenStore = seededTokenStore(),
) {
  const agentRepository = {
    findById: jest.fn().mockResolvedValue({
      _id: 'agent-1',
      isActive: true,
      deploymentSettings,
    }),
  };
  const logger = { setContext: jest.fn(), warn: jest.fn(), debug: jest.fn() };
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(mode) } as unknown as Reflector;

  return { guard: new WidgetTokenGuard(tokenStore as any, agentRepository as any, reflector, logger as any), tokenStore };
}

describe('WidgetTokenGuard deployment mode enforcement', () => {
  it('allows embed routes when embed deployment is enabled', async () => {
    const { guard } = createGuard('embed', { embedEnabled: true, restEnabled: false });
    const { context, request } = createExecutionContext('/widget/chat');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect((request as any).widgetAgentId).toBe('agent-1');
  });

  it('rejects embed routes when embed deployment is disabled', async () => {
    const { guard } = createGuard('embed', { embedEnabled: false, restEnabled: true });
    const { context } = createExecutionContext('/widget/chat');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('allows REST integration routes when REST deployment is enabled', async () => {
    const { guard } = createGuard('rest', { embedEnabled: false, restEnabled: true });
    const { context } = createExecutionContext('/integrations/agents/agent-1/messages');

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects REST integration routes when REST deployment is disabled', async () => {
    const { guard } = createGuard('rest', { embedEnabled: true, restEnabled: false });
    const { context } = createExecutionContext('/integrations/agents/agent-1/messages');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('falls back to REST mode for integrations paths without metadata', async () => {
    const { guard } = createGuard(undefined, { embedEnabled: true, restEnabled: false });
    const { context } = createExecutionContext('/integrations/agents/agent-1/messages');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects inactive tokens', async () => {
    const tokenStore = seededTokenStore({ isActive: false });
    const { guard } = createGuard('embed', { embedEnabled: true }, tokenStore);
    const { context } = createExecutionContext('/widget/chat');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects expired tokens even when active', async () => {
    const tokenStore = seededTokenStore({ expiresAt: new Date(Date.now() - 1000) });
    const { guard } = createGuard('embed', { embedEnabled: true }, tokenStore);
    const { context } = createExecutionContext('/widget/chat');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects unknown token hashes', async () => {
    const { guard } = createGuard('embed', { embedEnabled: true }, new InMemoryWidgetTokenStore());
    const { context } = createExecutionContext('/widget/chat');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
