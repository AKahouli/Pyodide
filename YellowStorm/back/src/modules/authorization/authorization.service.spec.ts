import { AuthorizationService } from './authorization.service';
import { PgRoleStore } from './persistence/pg-role.store';
import type { RoleRecord } from './persistence/role.store';

describe('AuthorizationService current user roles', () => {
  it('returns each fresh ordered store result without user hydration or an authorization cache', async () => {
    const first: RoleRecord = {
      id: '111111111111111111111111', name: 'reader', description: 'Read access',
      permissions: ['spec.read'], isActive: true, isSystem: false, priority: 3,
      createdAt: new Date(0), updatedAt: new Date(0),
    };
    const second = { ...first, id: '222222222222222222222222', name: 'editor' };
    const roleStore = { findActiveForUser: jest.fn().mockResolvedValueOnce([second, first]).mockResolvedValueOnce([]) };
    const userStore = { findByIdWithRoles: jest.fn() };
    const service = new AuthorizationService(roleStore as unknown as PgRoleStore,
      userStore as never, { setContext: jest.fn() } as never);
    expect(await service.getUserRoles('owner')).toEqual([second, first]);
    expect(await service.getUserRoles('owner')).toEqual([]);
    expect(roleStore.findActiveForUser.mock.calls).toEqual([['owner'], ['owner']]);
    expect(userStore.findByIdWithRoles).not.toHaveBeenCalled();
  });

  it('propagates current-role read failures', async () => {
    const failure = new Error('role lookup failed');
    const service = new AuthorizationService({ findActiveForUser: jest.fn().mockRejectedValue(failure) } as never,
      {} as never, { setContext: jest.fn() } as never);
    await expect(service.getUserRoles('owner')).rejects.toBe(failure);
  });
});
