import { BadRequestException, NotFoundException } from '@nestjs/common';
import { newObjectId } from '@common/postgres/object-id';
import { TeamShareService } from './team-share.service';
import type { TeamRow, TeamShareRow } from '../persistence/team.store';
import type { UserSummary } from '@common/ports/user-lookup.port';

describe('TeamShareService', () => {
  const owner: UserSummary = { id: newObjectId(), email: 'owner@x.test', firstName: 'O', lastName: 'W' };
  const alice: UserSummary = { id: newObjectId(), email: 'alice@x.test', firstName: 'Al', lastName: 'Ice' };
  const users = [owner, alice];
  const teamId = newObjectId();

  let rows: TeamShareRow[];
  let shareStore: any;
  let teamStore: any;
  let lookup: any;
  let service: TeamShareService;

  beforeEach(() => {
    rows = [];
    shareStore = {
      upsertMany: jest.fn(async (tid: string, by: string, ids: string[], permission: string) =>
        ids.map((sharedWith) => {
          const existing = rows.find((r) => r.teamId === tid && r.sharedWith === sharedWith);
          if (existing) { existing.permission = permission; return existing; }
          const row = { id: newObjectId(), teamId: tid, sharedBy: by, sharedWith, permission, createdAt: new Date(), updatedAt: new Date() } as TeamShareRow;
          rows.push(row);
          return row;
        })),
      findByTeam: jest.fn(async (tid: string) => rows.filter((r) => r.teamId === tid)),
      find: jest.fn(async (tid: string, w: string) => rows.find((r) => r.teamId === tid && r.sharedWith === w) ?? null),
      updatePermission: jest.fn(async (id: string, tid: string, p: string) => {
        const r = rows.find((x) => x.id === id && x.teamId === tid);
        if (r) r.permission = p;
        return r ?? null;
      }),
      deleteByIdAndTeam: jest.fn(async (id: string, tid: string) => {
        const i = rows.findIndex((x) => x.id === id && x.teamId === tid);
        return i >= 0 ? rows.splice(i, 1)[0] : null;
      }),
      deleteForUser: jest.fn(async (tid: string, u: string) => {
        const i = rows.findIndex((x) => x.teamId === tid && x.sharedWith === u);
        return i >= 0 ? rows.splice(i, 1)[0] : null;
      }),
      listSharedWithUser: jest.fn(async (u: string) => rows.filter((r) => r.sharedWith === u)),
    };
    teamStore = { findByIds: jest.fn(async () => []) };
    lookup = {
      byIds: jest.fn(async (ids: string[]) => new Map(users.filter((u) => ids.includes(u.id)).map((u) => [u.id, u]))),
      byEmails: jest.fn(async (emails: string[]) => new Map(users.filter((u) => emails.includes(u.email)).map((u) => [u.email, u]))),
    };
    const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() };
    service = new TeamShareService(shareStore, teamStore, lookup, logger as never);
  });

  it('resolves emails in one batched lookup and upserts once', async () => {
    const res = await service.shareTeam(owner.id, teamId, { emails: ['ALICE@x.test', 'alice@x.test', 'ghost@x.test'], permission: 'write' } as never);
    expect(lookup.byEmails).toHaveBeenCalledTimes(1);
    expect(lookup.byEmails).toHaveBeenCalledWith(['alice@x.test', 'ghost@x.test']);
    expect(shareStore.upsertMany).toHaveBeenCalledWith(teamId, owner.id, [alice.id], 'write');
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ permission: 'write', user: { email: alice.email, firstName: 'Al' } });
  });

  it('rejects self-share and unresolvable batches', async () => {
    await expect(service.shareTeam(owner.id, teamId, { emails: [owner.email], permission: 'read' } as never)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.shareTeam(owner.id, teamId, { emails: ['ghost@x.test'], permission: 'read' } as never)).rejects.toBeInstanceOf(NotFoundException);
    expect(shareStore.upsertMany).not.toHaveBeenCalled();
  });

  it('re-share updates the permission of the existing row', async () => {
    await service.shareTeam(owner.id, teamId, { emails: [alice.email], permission: 'read' } as never);
    const res = await service.shareTeam(owner.id, teamId, { emails: [alice.email], permission: 'write' } as never);
    expect(rows).toHaveLength(1);
    expect(res[0].permission).toBe('write');
  });

  it('lists shares, updates and removes them with 404 guards', async () => {
    const [entry] = await service.shareTeam(owner.id, teamId, { emails: [alice.email], permission: 'read' } as never);
    expect((await service.getTeamShares(teamId))[0].user.id).toBe(alice.id);
    expect((await service.updateSharePermission(teamId, entry.shareId, { permission: 'write' } as never)).permission).toBe('write');
    await expect(service.updateSharePermission(teamId, 'bad', { permission: 'write' } as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.removeShare(teamId, 'bad')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.removeShare(teamId, newObjectId())).rejects.toBeInstanceOf(NotFoundException);
    await service.removeShare(teamId, entry.shareId);
    expect(rows).toHaveLength(0);
  });

  it('unshareFromSelf removes own share, 404 when absent', async () => {
    await service.shareTeam(owner.id, teamId, { emails: [alice.email], permission: 'read' } as never);
    await service.unshareFromSelf(alice.id, teamId);
    await expect(service.unshareFromSelf(alice.id, teamId)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('getSharedTeamsForUser attaches shareInfo, drops inactive teams and orders newest first', async () => {
    const t1 = newObjectId(); const t2 = newObjectId(); const t3 = newObjectId();
    for (const t of [t1, t2, t3]) await service.shareTeam(owner.id, t, { emails: [alice.email], permission: 'read' } as never);
    const mk = (id: string, isActive: boolean, day: number): TeamRow => ({
      id, name: id, description: '', isActive, createdBy: owner.id, members: [],
      createdAt: new Date(2026, 0, day), updatedAt: new Date(2026, 0, day),
    });
    teamStore.findByIds.mockResolvedValue([mk(t1, true, 1), mk(t2, true, 5), mk(t3, false, 9)]);

    const teams = await service.getSharedTeamsForUser(alice.id);
    expect(teams.map((t) => t.id)).toEqual([t2, t1]);
    expect(teams[0].shareInfo).toMatchObject({ permission: 'read', sharedBy: { id: owner.id } });
    expect(await service.getSharedTeamsForUser(owner.id)).toEqual([]);
  });

  it('getSharePermission / getShareInfo', async () => {
    await service.shareTeam(owner.id, teamId, { emails: [alice.email], permission: 'write' } as never);
    expect(await service.getSharePermission(alice.id, teamId)).toBe('write');
    expect(await service.getSharePermission(owner.id, teamId)).toBeNull();
    expect((await service.getShareInfo(alice.id, teamId))!.sharedBy.email).toBe(owner.email);
    expect(await service.getShareInfo(owner.id, teamId)).toBeNull();
  });
});
