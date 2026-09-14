import { Types } from 'mongoose';
import { TeamService } from './team.service';

/**
 * Focused unit tests for the conversation-facing bits of TeamService:
 * `resolveAgentIds` (the @TeamName → agents expansion) and `removeAgentFromAllTeams`.
 */
describe('TeamService', () => {
  const userId = new Types.ObjectId().toString();
  let teamModel: any;
  let logger: any;
  let agentService: any;
  let teamShareService: any;
  let service: TeamService;

  const member = (agentId: Types.ObjectId, order = 0, parentAgentId: Types.ObjectId | null = null) => ({
    agentId,
    parentAgentId,
    order,
    positionX: 0,
    positionY: 0,
  });

  beforeEach(() => {
    teamModel = {
      find: jest.fn(),
      findById: jest.fn(),
      updateMany: jest.fn(),
    };
    logger = { setContext: jest.fn(), log: jest.fn() };
    agentService = { findByIds: jest.fn(), findByIdsUnrestricted: jest.fn() };
    teamShareService = {
      getSharedTeamsForUser: jest.fn().mockResolvedValue([]),
      getShareInfo: jest.fn().mockResolvedValue(null),
      getSharePermission: jest.fn().mockResolvedValue(null),
      removeAllSharesForTeam: jest.fn().mockResolvedValue(undefined),
    };
    service = new TeamService(
      teamModel as any,
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
    const executableTeam = (ownerId: string, members: any[]) => ({
      _id: new Types.ObjectId(), createdBy: new Types.ObjectId(ownerId), isActive: true, members,
    });

    it('authorizes a shared team and resolves its exact nested topology', async () => {
      const ownerId = new Types.ObjectId().toString();
      const root = new Types.ObjectId();
      const nested = new Types.ObjectId();
      const leaf = new Types.ObjectId();
      teamModel.findById.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(executableTeam(ownerId, [
        member(root), member(nested, 0, root), member(leaf, 0, nested),
      ])) }) });
      teamShareService.getSharePermission.mockResolvedValue('read');
      agentService.findByIdsUnrestricted.mockResolvedValue([
        { id: root.toString(), isActive: true, agentType: { slug: 'manager' } },
        { id: nested.toString(), isActive: true, agentType: { slug: 'manager' } },
        { id: leaf.toString(), isActive: true, agentType: { slug: 'worker' } },
      ]);

      const result = await service.resolveExecutionDefinition(userId, new Types.ObjectId().toString());
      expect(result.nodes.map((node) => node.agentId)).toEqual([root, nested, leaf].map(String));
      expect(agentService.findByIdsUnrestricted).toHaveBeenCalledTimes(1);
    });

    it('fails closed after team access is revoked', async () => {
      teamModel.findById.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(executableTeam(new Types.ObjectId().toString(), [member(new Types.ObjectId())])) }) });
      teamShareService.getSharePermission.mockResolvedValue(null);
      await expect(service.resolveExecutionDefinition(userId, new Types.ObjectId().toString())).rejects.toThrow();
      expect(agentService.findByIdsUnrestricted).not.toHaveBeenCalled();
    });

    it('rejects an inactive or missing member instead of dropping it', async () => {
      const root = new Types.ObjectId();
      const leaf = new Types.ObjectId();
      teamModel.findById.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(executableTeam(userId, [member(root), member(leaf, 0, root)])) }) });
      agentService.findByIdsUnrestricted.mockResolvedValue([
        { id: root.toString(), isActive: true, agentType: { slug: 'manager' } },
      ]);
      await expect(service.resolveExecutionDefinition(userId, new Types.ObjectId().toString())).rejects.toThrow();
    });
  });

  describe('resolveAgentIds', () => {
    it('returns [] for empty input without hitting the DB', async () => {
      expect(await service.resolveAgentIds([], userId)).toEqual([]);
      expect(teamModel.find).not.toHaveBeenCalled();
    });

    it('flattens and dedupes agent IDs across the resolved teams', async () => {
      const a1 = new Types.ObjectId();
      const a2 = new Types.ObjectId();
      const a3 = new Types.ObjectId();
      teamModel.find.mockReturnValue({
        lean: () => ({
          exec: () =>
            Promise.resolve([
              { members: [member(a1, 0), member(a2, 1)] },
              { members: [member(a2, 0), member(a3, 1)] }, // a2 is shared → must be deduped
            ]),
        }),
      });

      const result = await service.resolveAgentIds(
        [new Types.ObjectId().toString(), new Types.ObjectId().toString()],
        userId,
      );

      expect(result.sort()).toEqual([a1.toString(), a2.toString(), a3.toString()].sort());
      // Only owned + active teams are queried.
      const filter = teamModel.find.mock.calls[0][0];
      expect(filter.createdBy).toBeInstanceOf(Types.ObjectId);
      expect(filter.isActive).toBe(true);
    });

    it('orders agents by hierarchy (root before its children)', async () => {
      const root = new Types.ObjectId();
      const child = new Types.ObjectId();
      teamModel.find.mockReturnValue({
        lean: () => ({
          exec: () =>
            Promise.resolve([{ members: [member(child, 0, root), member(root, 0, null)] }]),
        }),
      });

      const result = await service.resolveAgentIds([new Types.ObjectId().toString()], userId);
      expect(result).toEqual([root.toString(), child.toString()]);
    });

    it('ignores invalid team IDs', async () => {
      const result = await service.resolveAgentIds(['not-an-id'], userId);
      expect(result).toEqual([]);
      expect(teamModel.find).not.toHaveBeenCalled();
    });
  });

  describe('removeAgentFromAllTeams', () => {
    it('pulls the agent from members and re-roots its children', async () => {
      const exec = jest.fn().mockResolvedValue({ modifiedCount: 2 });
      teamModel.updateMany.mockReturnValue({ exec });
      const agentId = new Types.ObjectId().toString();

      await service.removeAgentFromAllTeams(agentId);

      // First call pulls the member; second call nulls dangling parent refs.
      const [pullMatch, pullUpdate] = teamModel.updateMany.mock.calls[0];
      expect(pullMatch['members.agentId'].toString()).toBe(agentId);
      expect(pullUpdate.$pull.members.agentId.toString()).toBe(agentId);

      const [parentMatch] = teamModel.updateMany.mock.calls[1];
      expect(parentMatch['members.parentAgentId'].toString()).toBe(agentId);
    });

    it('is a no-op for an invalid agent id', async () => {
      await service.removeAgentFromAllTeams('bad');
      expect(teamModel.updateMany).not.toHaveBeenCalled();
    });
  });
});
