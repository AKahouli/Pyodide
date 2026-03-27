import { describe, expect, it } from 'vitest';
import { ADMIN_ACCESS_PERMISSIONS, ADMIN_MENU_ITEMS } from './constants';

describe('admin constants', () => {
  it('keeps access permissions and menu ids unique', () => {
    expect(ADMIN_ACCESS_PERMISSIONS).toContain('admin.*');
    expect(new Set(ADMIN_MENU_ITEMS.map((item) => item.id)).size).toBe(ADMIN_MENU_ITEMS.length);
  });

  it('declares required fields for each menu item', () => {
    for (const item of ADMIN_MENU_ITEMS) {
      expect(item.path.startsWith('/admin')).toBe(true);
      expect(item.permissions.length).toBeGreaterThan(0);
      expect(item.labelKey).toContain('menu.');
      expect(item.descriptionKey).toContain('menu.');
    }
  });
});
