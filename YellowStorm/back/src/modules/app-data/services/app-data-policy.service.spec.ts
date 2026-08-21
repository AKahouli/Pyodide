import { AppDataPolicyService } from './app-data-policy.service';

describe('AppDataPolicyService', () => {
  const db = {
    insert: jest.fn(() => ({
      values: jest.fn().mockReturnThis(),
      onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
    })),
    select: jest.fn(() => ({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([]),
    })),
  };
  const catalog = {
    requireAppByWorkspace: jest.fn().mockResolvedValue({ id: 'app-1', workspaceId: 'ws-1' }),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };

  let service: AppDataPolicyService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AppDataPolicyService(db as never, catalog as never, audit as never);
  });

  it('seeds default DEV policies for new tables', async () => {
    const applySpy = jest.spyOn(service, 'applyPolicies').mockResolvedValue({});

    await service.ensureDevDefaultPolicies({
      workspaceId: 'ws-1',
      tableNames: ['tasks', 'notes'],
    });

    expect(applySpy).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      environment: 'dev',
      policies: {
        tasks: {
          select: ['anonymous', 'yellowmind_owner'],
          insert: ['anonymous', 'yellowmind_owner'],
          update: ['anonymous', 'yellowmind_owner'],
          delete: ['anonymous', 'yellowmind_owner'],
        },
        notes: {
          select: ['anonymous', 'yellowmind_owner'],
          insert: ['anonymous', 'yellowmind_owner'],
          update: ['anonymous', 'yellowmind_owner'],
          delete: ['anonymous', 'yellowmind_owner'],
        },
      },
      actorPrincipal: 'schema_apply',
    });
  });

  it('strips anonymous principals when replicating policies to prod', async () => {
    db.select.mockReturnValue({
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockResolvedValue([
        {
          tableName: 'tasks',
          policyJson: {
            select: ['anonymous', 'yellowmind_owner'],
            insert: ['anonymous'],
            update: ['yellowmind_owner'],
            delete: [],
          },
        },
      ]),
    });
    const insertChain = {
      values: jest.fn().mockReturnThis(),
      onConflictDoUpdate: jest.fn().mockResolvedValue(undefined),
    };
    db.insert.mockReturnValue(insertChain);

    await service.replicatePolicies('app-1', 'dev', 'prod');

    expect(insertChain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        environment: 'prod',
        tableName: 'tasks',
        policyJson: {
          select: ['yellowmind_owner'],
          insert: [],
          update: ['yellowmind_owner'],
          delete: [],
        },
      }),
    );
  });
});
