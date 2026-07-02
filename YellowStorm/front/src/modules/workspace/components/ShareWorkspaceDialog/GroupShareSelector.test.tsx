import { describe, it, expect, vi } from 'vitest';
import { expandGroupToPending } from './GroupShareSelector';
import type { UserGroup } from '@/modules/groups';

// GroupShareSelector imports the real `@/modules/groups` module at runtime
// (useGroups, useGroupsStore). That module chain transitively resolves
// through @/lib/api/client -> @/modules/notifications -> ... -> a component
// that imports `d3`, which is declared in package.json but missing from
// node_modules and breaks vitest module loading. The helper under test
// (`expandGroupToPending`) is pure and doesn't touch the groups store or
// API, so we mock the module to isolate it, mirroring the factory-mock
// convention used by sibling tests (e.g. agent/store.test.ts,
// connected-app/store.test.ts) for `@/modules/localization/i18nInstance`.
// vi.mock calls are hoisted above imports by Vitest, so this still
// intercepts the module before `./GroupShareSelector` (and its own import
// of `@/modules/groups`) is evaluated.
vi.mock('@/modules/groups', () => ({
  useGroups: () => [],
  useGroupsStore: { getState: () => ({ fetchGroups: async () => {} }) },
}));

const group: UserGroup = {
  id: 'g1',
  name: 'Team',
  description: '',
  memberCount: 3,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
  members: [
    { id: 'u1', email: 'Alice@x.io' },
    { id: 'u2', email: 'bob@x.io' },
    { id: 'u3', email: 'owner@x.io' },
  ],
};

describe('expandGroupToPending', () => {
  it('maps members to pending shares with the chosen permission', () => {
    const result = expandGroupToPending(group, 'readwrite', [], 'nobody@x.io');
    expect(result).toEqual([
      { email: 'alice@x.io', permission: 'readwrite' },
      { email: 'bob@x.io', permission: 'readwrite' },
      { email: 'owner@x.io', permission: 'readwrite' },
    ]);
  });

  it('skips the workspace owner (case-insensitive)', () => {
    const result = expandGroupToPending(group, 'read', [], 'OWNER@x.io');
    expect(result.map((r) => r.email)).toEqual(['alice@x.io', 'bob@x.io']);
  });

  it('skips emails already pending (case-insensitive)', () => {
    const result = expandGroupToPending(group, 'read', ['ALICE@x.io'], 'nobody@x.io');
    expect(result.map((r) => r.email)).toEqual(['bob@x.io', 'owner@x.io']);
  });
});
