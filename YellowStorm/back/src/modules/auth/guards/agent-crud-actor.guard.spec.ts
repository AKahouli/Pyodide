import type { ExecutionContext } from '@nestjs/common';
import { AgentCrudActorGuard } from './agent-crud-actor.guard';

const context = (headers: Record<string, string>): ExecutionContext => ({
  switchToHttp: () => ({ getRequest: () => ({ headers }) }),
} as unknown as ExecutionContext);

describe('AgentCrudActorGuard', () => {
  const userId = '507f1f77bcf86cd799439011';
  const users = { findById: jest.fn() };
  const guard = () => new AgentCrudActorGuard(users as never);

  it('accepts a current user without optional trace headers', async () => {
    users.findById.mockResolvedValue({ status: 'active' });
    await expect(guard().canActivate(context({ 'x-yellowstorm-user-id': userId }))).resolves.toBe(true);
    expect(users.findById).toHaveBeenCalledWith(userId);
  });

  it.each([null, { status: 'inactive' }, { status: 'suspended' }])('rejects unavailable accounts', async (user) => {
    users.findById.mockResolvedValue(user);
    await expect(guard().canActivate(context({ 'x-yellowstorm-user-id': userId }))).rejects.toThrow();
  });
});
