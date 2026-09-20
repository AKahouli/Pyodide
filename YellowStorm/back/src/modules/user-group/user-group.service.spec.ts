import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { UserGroupService } from './user-group.service';
import { LoggerService } from '../logger';
import { USER_GROUP_STORE, type PopulatedGroupRecord, type UserGroupStore } from './persistence/user-group.store';

const OWNER = new Types.ObjectId().toString();
const OTHER = new Types.ObjectId().toString();
const MEMBER_A = new Types.ObjectId().toString();
const MEMBER_B = new Types.ObjectId().toString();

function member(id: string, email: string): PopulatedGroupRecord['members'][number] {
  return { id, email, firstName: 'F', lastName: 'L' };
}

function group(overrides: Partial<PopulatedGroupRecord> = {}): PopulatedGroupRecord {
  return {
    id: new Types.ObjectId().toString(),
    name: 'My Group',
    description: '',
    createdBy: OWNER,
    members: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/** In-memory UserGroupStore fake mirroring the port contract. */
function fakeStore(seed: PopulatedGroupRecord[] = []): UserGroupStore {
  const groups = [...seed];
  return {
    create: jest.fn(async (init) => {
      const created = group({ name: init.name, description: init.description, createdBy: init.ownerId });
      groups.push(created);
      return created;
    }),
    existsOwnedByName: jest.fn(async (ownerId, name, excludeId) =>
      groups.some((g) => g.createdBy === ownerId && g.name === name && g.id !== excludeId),
    ),
    findAllForUser: jest.fn(async (ownerId) => groups.filter((g) => g.createdBy === ownerId)),
    findOwnedById: jest.fn(async (ownerId, id) => groups.find((g) => g.id === id && g.createdBy === ownerId) ?? null),
    findOwnedByIds: jest.fn(async (ownerId, ids) => groups.filter((g) => ids.includes(g.id) && g.createdBy === ownerId)),
    update: jest.fn(async (id, patch) => {
      const g = groups.find((x) => x.id === id);
      if (g) Object.assign(g, patch);
    }),
    deleteById: jest.fn(async (id) => {
      const idx = groups.findIndex((g) => g.id === id);
      if (idx >= 0) groups.splice(idx, 1);
    }),
    addMembers: jest.fn(async (id, userIds) => {
      const g = groups.find((x) => x.id === id);
      if (!g) return;
      for (const userId of userIds) if (!g.members.some((m) => m.id === userId)) g.members.push(member(userId, `${userId}@x.io`));
    }),
    removeMember: jest.fn(async (id, memberId) => {
      const g = groups.find((x) => x.id === id);
      if (g) g.members = g.members.filter((m) => m.id !== memberId);
    }),
    findOwnedGroupIdsForMember: jest.fn(async () => []),
    findGroupIdsForMember: jest.fn(async () => []),
  };
}

async function setup(store: UserGroupStore): Promise<{ service: UserGroupService; store: UserGroupStore }> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    providers: [
      UserGroupService,
      { provide: USER_GROUP_STORE, useValue: store },
      { provide: LoggerService, useValue: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
    ],
  }).compile();
  return { service: moduleRef.get(UserGroupService), store };
}

describe('UserGroupService', () => {
  it('rejects a duplicate name for the same owner', async () => {
    const store = fakeStore([group({ name: 'My Group' })]);
    const { service } = await setup(store);
    await expect(service.create(OWNER, { name: 'My Group' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('creates a group and returns a mapped response with memberCount', async () => {
    const store = fakeStore();
    const { service } = await setup(store);
    const res = await service.create(OWNER, { name: 'New', memberIds: [MEMBER_A] });
    expect(res.name).toBe('New');
    expect(res.memberCount).toBe(0);
    expect(store.create).toHaveBeenCalledWith({ ownerId: OWNER, name: 'New', description: '', memberIds: [MEMBER_A] });
  });

  it('throws NotFound when the group belongs to another user', async () => {
    const owned = group({ createdBy: OTHER });
    const { service } = await setup(fakeStore([owned]));
    await expect(service.findById(OWNER, owned.id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFound for a malformed id', async () => {
    const { service } = await setup(fakeStore());
    await expect(service.findById(OWNER, 'not-an-id')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('members arrive already filtered by the store (populate parity handled there)', async () => {
    const owned = group({ members: [member(MEMBER_A, 'a@x.io')] });
    const { service } = await setup(fakeStore([owned]));
    const res = await service.findById(OWNER, owned.id);
    expect(res.members).toEqual([{ id: MEMBER_A, email: 'a@x.io', firstName: 'F', lastName: 'L' }]);
    expect(res.memberCount).toBe(1);
  });

  it('rejects renaming to a name that clashes with another group of the same owner', async () => {
    const owned = group({ name: 'Old Name' });
    const clash = group({ name: 'New Name' });
    const { service } = await setup(fakeStore([owned, clash]));
    await expect(service.update(OWNER, owned.id, { name: 'New Name' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('throws NotFound when a non-owner tries to update', async () => {
    const foreign = group({ createdBy: OTHER });
    const { service } = await setup(fakeStore([foreign]));
    await expect(service.update(OWNER, foreign.id, { name: 'New Name' })).rejects.toBeInstanceOf(NotFoundException);
  });

  it('renames and updates the description', async () => {
    const owned = group({ name: 'Old Name', description: 'Old desc' });
    const { service, store } = await setup(fakeStore([owned]));
    const res = await service.update(OWNER, owned.id, { name: 'New Name', description: 'New desc' });
    expect(res.name).toBe('New Name');
    expect(res.description).toBe('New desc');
    expect(store.update).toHaveBeenCalledWith(owned.id, { name: 'New Name', description: 'New desc' });
  });

  it('deletes the group when called by its owner', async () => {
    const owned = group();
    const { service, store } = await setup(fakeStore([owned]));
    await service.delete(OWNER, owned.id);
    expect(store.deleteById).toHaveBeenCalledWith(owned.id);
  });

  it('throws NotFound when a non-owner tries to delete', async () => {
    const foreign = group({ createdBy: OTHER });
    const { service, store } = await setup(fakeStore([foreign]));
    await expect(service.delete(OWNER, foreign.id)).rejects.toBeInstanceOf(NotFoundException);
    expect(store.deleteById).not.toHaveBeenCalled();
  });

  it('adds members idempotently and returns the populated group', async () => {
    const owned = group();
    const { service } = await setup(fakeStore([owned]));
    const res = await service.addMembers(OWNER, owned.id, [MEMBER_A]);
    expect(res.members.map((m) => m.id)).toContain(MEMBER_A);
    expect(res.memberCount).toBe(1);
  });

  it('removes a member', async () => {
    const owned = group({ members: [member(MEMBER_A, 'a@x.io'), member(MEMBER_B, 'b@x.io')] });
    const { service } = await setup(fakeStore([owned]));
    const res = await service.removeMember(OWNER, owned.id, MEMBER_A);
    expect(res.members.map((m) => m.id)).toEqual([MEMBER_B]);
  });

  it('removeMember with a malformed id is a silent no-op on the store', async () => {
    const owned = group({ members: [member(MEMBER_A, 'a@x.io')] });
    const { service } = await setup(fakeStore([owned]));
    const res = await service.removeMember(OWNER, owned.id, 'not-an-id');
    expect(res.memberCount).toBe(1);
  });

  it('findGroupIdsForMember and findOwnedGroupIdsForMember delegate to the store', async () => {
    const store = fakeStore();
    const { service } = await setup(store);
    await service.findGroupIdsForMember(MEMBER_A);
    await service.findOwnedGroupIdsForMember(OWNER, MEMBER_A);
    expect(store.findGroupIdsForMember).toHaveBeenCalledWith(MEMBER_A);
    expect(store.findOwnedGroupIdsForMember).toHaveBeenCalledWith(OWNER, MEMBER_A);
  });

  it('findOwnedGroupsByIds returns only owned groups', async () => {
    const mine = group();
    const theirs = group({ createdBy: OTHER });
    const { service } = await setup(fakeStore([mine, theirs]));
    const res = await service.findOwnedGroupsByIds(OWNER, [mine.id, theirs.id]);
    expect(res.map((g) => g.id)).toEqual([mine.id]);
  });
});
