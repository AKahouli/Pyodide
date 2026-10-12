import type { ExecutionContext } from '@nestjs/common';
jest.mock('../services/semantic-model-assistant.service', () => ({ SemanticModelAssistantService: class {} }));
import { SemanticAssistantActorGuard } from './semantic-assistant-actor.guard';

const context = (headers: Record<string, string>): ExecutionContext => ({
  switchToHttp: () => ({ getRequest: () => ({ headers }) }),
} as unknown as ExecutionContext);

describe('SemanticAssistantActorGuard', () => {
  const userId = '507f1f77bcf86cd799439011';
  const users = { findById: jest.fn() };
  const authorization = { getUserRoles: jest.fn().mockResolvedValue([{ id: 'role-1' }]), getUserPermissions: jest.fn().mockResolvedValue(['semantic-models.read']) };
  const guard = () => new SemanticAssistantActorGuard(authorization as never, users as never);
  const headers = { 'x-yellowstorm-user-id': userId, 'x-correlation-id': 'request-1' };

  it('loads platform permissions for an active user', async () => {
    users.findById.mockResolvedValue({ status: 'active' });
    await expect(guard().canActivate(context(headers))).resolves.toBe(true);
    expect(authorization.getUserRoles).toHaveBeenCalledWith(userId);
  });

  it.each([null, { status: 'inactive' }, { status: 'suspended' }])('rejects unavailable accounts before loading permissions', async (user) => {
    users.findById.mockResolvedValue(user);
    authorization.getUserRoles.mockClear();
    await expect(guard().canActivate(context(headers))).rejects.toThrow();
    expect(authorization.getUserRoles).not.toHaveBeenCalled();
  });
});
