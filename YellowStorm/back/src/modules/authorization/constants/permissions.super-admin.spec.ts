import { Permissions, hasPermission } from './permissions';

describe('hasPermission Super Admin gate', () => {
  it('grants SUPER_ADMIN only to the * permission', () => {
    expect(hasPermission(['*'], Permissions.SUPER_ADMIN)).toBe(true);
    expect(hasPermission(['users.*'], Permissions.SUPER_ADMIN)).toBe(false);
    expect(hasPermission(['users.activate', 'users.suspend'], Permissions.SUPER_ADMIN)).toBe(
      false,
    );
  });
});
