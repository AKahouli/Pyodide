import type { ExecutionContext } from '@nestjs/common';
import { PlaybookAssistantActorGuard } from './playbook-assistant-actor.guard';

const contextWithHeaders = (headers: Record<string, string | undefined>): ExecutionContext => ({
  switchToHttp: () => ({ getRequest: () => ({ headers }) }),
} as unknown as ExecutionContext);

describe('PlaybookAssistantActorGuard', () => {
  const users = { findById: jest.fn().mockResolvedValue({ status: 'active' }) };
  const guard = () => new PlaybookAssistantActorGuard(users as never);
  const actorHeaders = {
    'x-yellowstorm-user-id': 'user-1',
    'x-yellowstorm-agent-id': 'agent-1',
    'x-yellowstorm-conversation-id': 'conversation-1',
    'x-correlation-id': 'correlation-1',
  };

  beforeEach(() => users.findById.mockResolvedValue({ status: 'active' }));

  it('accepts a complete actor without a synthetic tenant header', async () => {
    await expect(guard().canActivate(contextWithHeaders(actorHeaders))).resolves.toBe(true);
  });

  it('accepts a signed user without conversation metadata for ordinary reads', async () => {
    await expect(guard().canActivate(contextWithHeaders({ 'x-yellowstorm-user-id': 'user-1' }))).resolves.toBe(true);
  });

  it('fails closed when the acting user is missing', async () => {
    await expect(guard().canActivate(contextWithHeaders({
      ...actorHeaders,
      'x-yellowstorm-user-id': undefined,
    }))).rejects.toThrow('Missing or invalid trusted Playbook assistant actor identity');
  });

  it.each(['suspended', 'inactive'])('rejects a %s user before Playbook access', async (status) => {
    users.findById.mockResolvedValue({ status });
    await expect(guard().canActivate(contextWithHeaders(actorHeaders))).rejects.toThrow();
  });
});
