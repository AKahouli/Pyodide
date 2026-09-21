import { Types } from 'mongoose';
import { TeamService } from './team.service';
import { TEAM_STORE, type TeamRow, type TeamStore } from './persistence/team.store';

/**
 * Focused unit tests for the conversation-facing bits of TeamService:
 * `resolveAgentIds` and `resolveExecutionDefinition`.
 * (removeAgentFromAllTeams was deleted in plan 4.3 — team_members rows
 * cascade on agent delete and children re-root via ON DELETE SET NULL.)
 */
describe('TeamService', () => {
  const userId = new Types.ObjectId().toString();
  let store: InMemoryTeamStore;
  let logger: any;
  let agentService: any;
  let teamShareService: any;
  let service: TeamService;

  const member = (agentId: string, order = 0, parentAgentId: string | null = null) => ({
    agentId,
    parentAgentId,
    order,
    positionX: 0,
    positionY: 0,
  });

  class InMemoryTeamStore implements TeamStore {
    readonly rows: TeamRow[] = [];

    seed(over: { createdBy: string; members: TeamRow['members'] }): TeamRow {
      const row: TeamRow = {
        id: new Types.ObjectId().toString(),
        name: 'Team ' + this.rows.length,
        description: '',
        isActive: true,
        createdBy: over.createdBy,
        members: over.members,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.rows.push(row);
      return row;
    }

    async findByOwnerAndName(name: string, createdBy: string): Promise<TeamRow | null> {
      return this.rows.find((r) => r.name === name && r.createdBy === createdBy) ?? null;
    }

    async findNameClash(name: string, createdBy: string, excludeId: string): Promise<TeamRow | null> {
      return this.rows.find((r) => r.name === name && r.createdBy === createdBy && r.id !== excludeId) ?? null;
    }

    async create(row: { name: string; description: string; isActive: boolean; createdBy: string; members: TeamRow['members'] }): Promise<TeamRow> {
      return this.seed(row);
    }

    async list(query: { createdBy: string }): Promise<{ rows: TeamRow[]; total: number }> {
      const rows = this.rows.filter((r) => r.createdBy === query.createdBy);
      return { rows, total: rows.length };
    }

    async findActiveByOwner(userId: string): Promise<TeamRow[]> {
      return this.rows.filter((r) => r.createdBy === userId && r.isActive);
    }

    async findById(id: string): Promise<TeamRow | null> {
      return this.rows.find((r) => r.id === id) ?? null;
    }

    async update(id: string, patch: Partial<TeamRow>): Promise<TeamRow | null> {
      const row = this.rows.find((r) => r.id === id);
      if (!row) return null;
      Object.assign(row, patch);
      return row;
    }

    async delete(id: string): Promise<TeamRow | null> {
      const idx = this.rows.findIndex((r) => r.id === id);
      return idx >= 0 ? this.rows.splice(idx, 1)[0] : null;
    }

    async findByIdsActiveForOwner(ids: string[], createdBy: string): Promise<TeamRow[]> {
      return this.rows.filter((r) => ids.includes(r.id) && r.createdBy === createdBy && r.isActive);
    }

    async findByIds(ids: string[]): Promise<TeamRow[]> {
      return this.rows.filter((r) => ids.includes(r.id));
    }
  }

  beforeEach(() => {
    store = new InMemoryTeamStore();
    logger = { setContext: jest.fn(), log: jest.fn() };
    agentService = { findByIds: jest.fn(), findByIdsUnrestricted: jest.fn() };
    teamShareService = {
      getSharedTeamsForUser: jest.fn().mockResolvedValue([]),
      getShareInfo: jest.fn().mockResolvedValue(null),
      getSharePermission: jest.fn().mockResolvedValue(null),
    };
    service = new TeamService(
      store as unknown as TeamStore,
      logger as any,
      agentService as any,
      teamShareService as any,
      {} as any, // chatCompletionService
      {} as any, // autoBuilderConfigService
      {} as any, // agentTypeService
      {} as any, // toolService
      {} as any, // modelsService
    );
  });

  describe('resolveExecutionDefinition', () => {
    const oid = () => new Types.ObjectId().toString();

    it('authorizes a shared team and resolves its exact nested topology', async () => {
      const ownerId = oid();
      const root = oid();
      const nested = oid();
      const leaf = oid();
      store.seed({ createdBy: ownerId, members: [member(root), member(nested, 0, root), member(leaf, 0, nested)] });
      teamShareService.getSharePermission.mockResolvedValue('read');
      agentService.findByIdsUnrestricted.mockResolvedValue([
        { id: root, isActive: true, agentType: { slug: 'manager' } },
        { id: nested, isActive: true, agentType: { slug: 'manager' } },
        { id: leaf, isActive: true, agentType: { slug: 'worker' } },
      ]);

      const result = await service.resolveExecutionDefinition(userId, store.rows[0].id);
      expect(result.nodes.map((node) => node.agentId)).toEqual([root, nested, leaf]);
      expect(agentService.findByIdsUnrestricted).toHaveBeenCalledTimes(1);
    });

    it('fails closed after team access is revoked', async () => {
      store.seed({ createdBy: oid(), members: [member(oid())] });
      teamShareService.getSharePermission.mockResolvedValue(null);
      await expect(service.resolveExecutionDefinition(userId, store.rows[0].id)).rejects.toThrow();
      expect(agentService.findByIdsUnrestricted).not.toHaveBeenCalled();
    });

    it('rejects an inactive or missing member instead of dropping it', async () => {
      const root = oid();
      const leaf = oid();
      store.seed({ createdBy: userId, members: [member(root), member(leaf, 0, root)] });
      agentService.findByIdsUnrestricted.mockResolvedValue([
        { id: root, isActive: true, agentType: { slug: 'manager' } },
      ]);
      await expect(service.resolveExecutionDefinition(userId, store.rows[0].id)).rejects.toThrow();
    });
  });

  describe('resolveAgentIds', () => {
    it('returns [] for empty input without hitting the DB', async () => {
      const findByIdsActiveForOwner = jest.spyOn(store, 'findByIdsActiveForOwner');
      expect(await service.resolveAgentIds([], userId)).toEqual([]);
      expect(findByIdsActiveForOwner).not.toHaveBeenCalled();
    });

    it('flattens and dedupes agent IDs across the resolved teams', async () => {
      const a1 = new Types.ObjectId().toString();
      const a2 = new Types.ObjectId().toString();
      const a3 = new Types.ObjectId().toString();
      store.seed({ createdBy: userId, members: [member(a1, 0), member(a2, 1)] });
      store.seed({ createdBy: userId, members: [member(a2, 0), member(a3, 1)] }); // a2 shared → deduped

      const result = await service.resolveAgentIds(
        [store.rows[0].id, store.rows[1].id],
        userId,
      );

      expect(result.sort()).toEqual([a1, a2, a3].sort());
    });

    it('orders agents by hierarchy (root before its children)', async () => {
      const root = new Types.ObjectId().toString();
      const child = new Types.ObjectId().toString();
      store.seed({ createdBy: userId, members: [member(child, 0, root), member(root, 0, null)] });

      const result = await service.resolveAgentIds([store.rows[0].id], userId);
      expect(result).toEqual([root, child]);
    });

    it('ignores invalid team IDs', async () => {
      const result = await service.resolveAgentIds(['not-an-id'], userId);
      expect(result).toEqual([]);
    });
  });
});
