import { describe, expect, it } from 'vitest';
import { countSelectedRolePermissions, getManagedBranchPermissions, getMenuBranchPermissions, isScopedPermissionSelected, toggleScopedPermission, toggleScopedPermissions } from './RolePermissionsEditor';
import { DEFAULT_NAVIGATION_SETTINGS } from '../navigation';

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
    expect(countSelectedRolePermissions(['users.read'])).toBe(31);
    expect(countSelectedRolePermissions(['users.read', 'feature.workspace', 'menu.restricted'])).toBe(2);
    expect(isScopedPermissionSelected(['*', 'feature.restricted'], 'feature', 'feature.workspace')).toBe(true);
  });

  it('toggles complete nested menu branches', () => {
    const branch = getMenuBranchPermissions('agentNetwork');
    expect(branch).toEqual(['menu.agent_network', 'menu.agents', 'menu.teams', 'menu.groups']);
    expect(toggleScopedPermissions([], 'menu', branch, branch)).toEqual(['menu.restricted']);
  });

  it('derives role branches from the managed navigation tree', () => {
    expect(getManagedBranchPermissions(DEFAULT_NAVIGATION_SETTINGS, 'knowledge')).toEqual([
      'menu.workspace',
      'menu.semantic_models',
    ]);
    expect(getManagedBranchPermissions(DEFAULT_NAVIGATION_SETTINGS, 'build')).toEqual([
      'menu.workspace',
      'menu.semantic_models',
      'menu.agents',
      'menu.playbook',
      'menu.worky',
      'menu.connected_apps',
    ]);
  });
});
