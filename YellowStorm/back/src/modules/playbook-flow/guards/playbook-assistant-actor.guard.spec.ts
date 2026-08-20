import type { ExecutionContext } from '@nestjs/common';
import { PlaybookAssistantActorGuard } from './playbook-assistant-actor.guard';

const contextWithHeaders = (headers: Record<string, string | undefined>): ExecutionContext => ({
  switchToHttp: () => ({ getRequest: () => ({ headers }) }),
} as unknown as ExecutionContext);

describe('PlaybookAssistantActorGuard', () => {
  const actorHeaders = {
    'x-yellowstorm-user-id': 'user-1',
    'x-yellowstorm-agent-id': 'agent-1',
    'x-yellowstorm-conversation-id': 'conversation-1',
    'x-correlation-id': 'correlation-1',
  };

  it('accepts a complete actor without a synthetic tenant header', () => {
    expect(new PlaybookAssistantActorGuard().canActivate(contextWithHeaders(actorHeaders))).toBe(true);
  });

  it.each(Object.keys(actorHeaders))('fails closed when %s is missing', (header) => {
    expect(() => new PlaybookAssistantActorGuard().canActivate(contextWithHeaders({
      ...actorHeaders,
      [header]: undefined,
    }))).toThrow('Missing or invalid trusted Playbook assistant actor identity');
  });
});
