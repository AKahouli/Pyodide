import { describe, expect, it } from 'vitest';
import { PERMISSION_GROUPS } from './types';

describe('admin types constants', () => {
  it('contains unique permission namespaces and non-empty permission values', () => {
    const namespaces = PERMISSION_GROUPS.map((group) => group.namespace);
    expect(new Set(namespaces).size).toBe(namespaces.length);

    for (const group of PERMISSION_GROUPS) {
      expect(group.permissions.length).toBeGreaterThan(0);
      expect(group.permissions.every((perm) => perm.value.length > 0)).toBe(true);
    }
  });
});
