import { describe, expect, it } from 'vitest';
import { countSelectedRolePermissions, isScopedPermissionSelected, toggleScopedPermission } from './RolePermissionsEditor';

describe('toggleScopedPermission', () => {
  const available = ['menu.platform', 'menu.admin'];

  it('turns an unrestricted legacy role into an allowlist on first uncheck', () => {
    expect(toggleScopedPermission(['users.read'], 'menu', available, 'menu.admin')).toEqual([
      'users.read',
      'menu.restricted',
      'menu.platform',
    ]);
  });

  it('keeps an explicit empty allowlist and normalizes all selected to unrestricted', () => {
    expect(toggleScopedPermission(['menu.restricted', 'menu.admin'], 'menu', available, 'menu.admin')).toEqual(['menu.restricted']);
    expect(toggleScopedPermission(['menu.restricted', 'menu.platform'], 'menu', available, 'menu.admin')).toEqual([]);
  });

  it('counts visible selections instead of internal restriction markers', () => {
    expect(countSelectedRolePermissions(['users.read'])).toBe(23);
    expect(countSelectedRolePermissions(['users.read', 'feature.workspace', 'menu.restricted'])).toBe(2);
    expect(isScopedPermissionSelected(['*', 'feature.restricted'], 'feature', 'feature.workspace')).toBe(true);
  });
});
