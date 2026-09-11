import { SemanticModelProvisioningService } from './semantic-model-provisioning.service';

describe('SemanticModelProvisioningService', () => {
  const logger = {
    setContext: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('does not fail a completed workspace rename when PostgreSQL is unavailable', async () => {
    const database = {
      isEnabled: jest.fn().mockReturnValue(true),
      query: jest.fn().mockRejectedValue(new Error('unavailable')),
    };
    const service = new SemanticModelProvisioningService(
      {} as never,
      {} as never,
      database as never,
      logger as never,
    );

    await expect(service.afterWorkspaceUpdated('owner-1', 'workspace-1', 'Renamed')).resolves.toBeUndefined();

    expect(database.query).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      'Semantic Model workspace name synchronization failed',
      expect.objectContaining({ workspaceId: 'workspace-1', attempt: 3 }),
    );
  });

  it('does not fail completed workspace deletion when PostgreSQL is unavailable', async () => {
    const database = {
      isEnabled: jest.fn().mockReturnValue(true),
      transaction: jest.fn().mockRejectedValue(new Error('unavailable')),
    };
    const service = new SemanticModelProvisioningService(
      {} as never,
      {} as never,
      database as never,
      logger as never,
    );

    await expect(service.afterWorkspaceDeleted('owner-1', 'workspace-1')).resolves.toBeUndefined();

    expect(database.transaction).toHaveBeenCalledTimes(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(
      'Semantic Model workspace deletion synchronization failed',
      expect.objectContaining({ workspaceId: 'workspace-1', attempt: 3 }),
    );
  });
});
