import { BadRequestException, NotFoundException } from '@nestjs/common';
import { newObjectId } from '@common/postgres/object-id';
import { AgentShareService } from './agent-share.service';
import type { AgentShareRow, AgentShareStore } from '../persistence/agent-share.store';
import type { UserLookupPort, UserSummary } from '@common/ports/user-lookup.port';

class FakeShareStore implements AgentShareStore {
  rows: AgentShareRow[] = [];
  upsertMany = jest.fn(async (agentId: string, sharedBy: string, ids: string[], permission: string) => {
    return ids.map((sharedWith) => {
      const existing = this.rows.find((r) => r.agentId === agentId && r.sharedWith === sharedWith);
      if (existing) {
        existing.permission = permission;
        return existing;
      }
      const row: AgentShareRow = {
        id: newObjectId(), agentId, sharedBy, sharedWith, permission, createdAt: new Date(), updatedAt: new Date(),
      };
      this.rows.push(row);
      return row;
    });
  });
  findByAgent = jest.fn(async (agentId: string) => this.rows.filter((r) => r.agentId === agentId));
  find = jest.fn(async (agentId: string, sharedWith: string) =>
    this.rows.find((r) => r.agentId === agentId && r.sharedWith === sharedWith) ?? null);
  findByIdAndAgent = jest.fn();
  findById = jest.fn();
  updatePermission = jest.fn(async (shareId: string, agentId: string, permission: string) => {
    const row = this.rows.find((r) => r.id === shareId && r.agentId === agentId);
    if (row) row.permission = permission;
    return row ?? null;
  });
  deleteByIdAndAgent = jest.fn(async (shareId: string, agentId: string) => {
    const i = this.rows.findIndex((r) => r.id === shareId && r.agentId === agentId);
    return i >= 0 ? this.rows.splice(i, 1)[0] : null;
  });
  deleteForUser = jest.fn(async (agentId: string, userId: string) => {
    const i = this.rows.findIndex((r) => r.agentId === agentId && r.sharedWith === userId);
    return i >= 0 ? this.rows.splice(i, 1)[0] : null;
  });
  listSharedWithUser = jest.fn(async (userId: string) => this.rows.filter((r) => r.sharedWith === userId));
}

describe('AgentShareService', () => {
  const owner: UserSummary = { id: newObjectId(), email: 'owner@x.test', firstName: 'O', lastName: 'W' };
  const alice: UserSummary = { id: newObjectId(), email: 'alice@x.test', firstName: 'Al', lastName: 'Ice' };
  const bob: UserSummary = { id: newObjectId(), email: 'bob@x.test', firstName: 'Bo', lastName: 'B' };
  const users = [owner, alice, bob];
  const agentId = newObjectId();

  let store: FakeShareStore;
  let lookup: jest.Mocked<UserLookupPort>;
  let service: AgentShareService;

  beforeEach(() => {
    store = new FakeShareStore();
    lookup = {
      byId: jest.fn(),
      byIds: jest.fn(async (ids: string[]) => new Map(users.filter((u) => ids.includes(u.id)).map((u) => [u.id, u]))),
      byEmails: jest.fn(async (emails: string[]) => new Map(users.filter((u) => emails.includes(u.email)).map((u) => [u.email, u]))),
    } as jest.Mocked<UserLookupPort>;
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service = new AgentShareService(store, lookup, logger as never);
  });

  it('resolves all emails in ONE batched byEmails call (normalized + deduped) and one upsert', async () => {
    const res = await service.shareAgent(owner.id, agentId, {
      emails: ['Alice@x.test', ' alice@x.test ', 'bob@x.test'], permission: 'read',
    } as never);

    expect(lookup.byEmails).toHaveBeenCalledTimes(1);
    expect(lookup.byEmails).toHaveBeenCalledWith(['alice@x.test', 'bob@x.test']);
    expect(store.upsertMany).toHaveBeenCalledTimes(1);
    expect(store.upsertMany).toHaveBeenCalledWith(agentId, owner.id, [alice.id, bob.id], 'read');
    expect(res.map((r) => r.user.email).sort()).toEqual(['alice@x.test', 'bob@x.test']);
    expect(res[0]).toMatchObject({ permission: 'read' });
  });

  it('re-sharing an existing recipient updates the permission (no duplicate row)', async () => {
    await service.shareAgent(owner.id, agentId, { emails: [alice.email], permission: 'read' } as never);
    const res = await service.shareAgent(owner.id, agentId, { emails: [alice.email], permission: 'write' } as never);

    expect(store.rows).toHaveLength(1);
    expect(res[0].permission).toBe('write');
  });

  it('rejects sharing with yourself before any write', async () => {
    await expect(
      service.shareAgent(owner.id, agentId, { emails: [owner.email, alice.email], permission: 'read' } as never),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(store.upsertMany).not.toHaveBeenCalled();
  });

  it('404s when no email resolves, and shares only the resolvable ones otherwise', async () => {
    await expect(
      service.shareAgent(owner.id, agentId, { emails: ['ghost@x.test'], permission: 'read' } as never),
    ).rejects.toBeInstanceOf(NotFoundException);

    const res = await service.shareAgent(owner.id, agentId, { emails: ['ghost@x.test', bob.email], permission: 'read' } as never);
    expect(res).toHaveLength(1);
    expect(res[0].user.id).toBe(bob.id);
  });

  it('getAgentShares maps rows to entries via one batched byIds', async () => {
    await service.shareAgent(owner.id, agentId, { emails: [alice.email, bob.email], permission: 'read' } as never);
    const list = await service.getAgentShares(agentId);
    expect(lookup.byIds).toHaveBeenCalledTimes(1);
    expect(list.map((l) => l.user.firstName).sort()).toEqual(['Al', 'Bo']);
    expect(list[0]).toEqual(expect.objectContaining({ shareId: expect.any(String), createdAt: expect.any(Date) }));
  });

  it('updateSharePermission / removeShare 404 on invalid id and on missing share', async () => {
    await expect(service.updateSharePermission(agentId, 'nope', { permission: 'write' } as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.updateSharePermission(agentId, newObjectId(), { permission: 'write' } as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.removeShare(agentId, 'nope')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.removeShare(agentId, newObjectId())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('updateSharePermission changes the level; removeShare deletes', async () => {
    const [entry] = await service.shareAgent(owner.id, agentId, { emails: [alice.email], permission: 'read' } as never);
    const updated = await service.updateSharePermission(agentId, entry.shareId, { permission: 'write' } as never);
    expect(updated.permission).toBe('write');
    await service.removeShare(agentId, entry.shareId);
    expect(store.rows).toHaveLength(0);
  });

  it('unshareFromSelf removes own share and 404s when none', async () => {
    await service.shareAgent(owner.id, agentId, { emails: [alice.email], permission: 'read' } as never);
    await service.unshareFromSelf(alice.id, agentId);
    await expect(service.unshareFromSelf(alice.id, agentId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('share info map, permission and info lookups reflect the sharer', async () => {
    await service.shareAgent(owner.id, agentId, { emails: [alice.email], permission: 'write' } as never);
    const map = await service.getShareInfoMapForUser(alice.id);
    expect(map.get(agentId)).toMatchObject({ permission: 'write', sharedBy: { id: owner.id, email: owner.email } });
    expect(await service.getSharePermission(alice.id, agentId)).toBe('write');
    expect(await service.getSharePermission(bob.id, agentId)).toBeNull();
    expect((await service.getShareInfo(alice.id, agentId))!.sharedBy.id).toBe(owner.id);
    expect(await service.getShareInfo(bob.id, agentId)).toBeNull();
  });
});
