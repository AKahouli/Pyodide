import { Permissions, isValidPermission } from './permissions';

describe('role visibility permissions', () => {
  it('accepts registered feature and menu permissions only', () => {
    expect(isValidPermission(Permissions.FEATURE_CONVERSATION)).toBe(true);
    expect(isValidPermission(Permissions.FEATURE_RESTRICTED)).toBe(true);
    expect(isValidPermission(Permissions.MENU_ADMIN)).toBe(true);
    expect(isValidPermission(Permissions.MENU_AGENT_NETWORK)).toBe(true);
    expect(isValidPermission(Permissions.MENU_HISTORY)).toBe(true);
    expect(isValidPermission(Permissions.MENU_RESTRICTED)).toBe(true);
    expect(isValidPermission('feature.unknown')).toBe(false);
    expect(isValidPermission('menu.unknown')).toBe(false);
  });
});
