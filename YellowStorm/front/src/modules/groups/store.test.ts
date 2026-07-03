import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('./api', () => ({
  getGroups: vi.fn(),
  createGroup: vi.fn(),
  updateGroup: vi.fn(),
  deleteGroup: vi.fn(),
  addMembers: vi.fn(),
  removeMember: vi.fn(),
  searchUsers: vi.fn(),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import * as api from './api';
import { useGroupsStore } from './store';
import type { UserGroup } from './types';

const groupA: UserGroup = {
  id: 'a', name: 'A', description: '', members: [], memberCount: 0,
  createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

describe('groups store', () => {
  beforeEach(() => {
    useGroupsStore.getState().reset();
    vi.clearAllMocks();
  });

  it('fetchGroups loads groups and sets initialized', async () => {
    vi.mocked(api.getGroups).mockResolvedValue([groupA]);
    await useGroupsStore.getState().fetchGroups();
    expect(useGroupsStore.getState().groups).toEqual([groupA]);
    expect(useGroupsStore.getState().isInitialized).toBe(true);
  });

  it('createGroup prepends the new group', async () => {
    const created = { ...groupA, id: 'b', name: 'B' };
    vi.mocked(api.createGroup).mockResolvedValue(created);
    useGroupsStore.setState({ groups: [groupA] });
    await useGroupsStore.getState().createGroup({ name: 'B' });
    expect(useGroupsStore.getState().groups.map((g) => g.id)).toEqual(['b', 'a']);
  });

  it('deleteGroup removes the group', async () => {
    vi.mocked(api.deleteGroup).mockResolvedValue();
    useGroupsStore.setState({ groups: [groupA] });
    await useGroupsStore.getState().deleteGroup('a');
    expect(useGroupsStore.getState().groups).toEqual([]);
  });

  it('addMembers replaces the group with the server copy', async () => {
    const updated = { ...groupA, memberCount: 1, members: [{ id: 'u1', email: 'u@x.io' }] };
    vi.mocked(api.addMembers).mockResolvedValue(updated);
    useGroupsStore.setState({ groups: [groupA] });
    await useGroupsStore.getState().addMembers('a', ['u1']);
    expect(useGroupsStore.getState().groups[0].memberCount).toBe(1);
  });
});
