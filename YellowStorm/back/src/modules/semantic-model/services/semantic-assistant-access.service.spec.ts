import { SemanticAssistantAccessService } from './semantic-assistant-access.service';

describe('SemanticAssistantAccessService', () => {
  it('enforces permissions unless an admin turned them off, and reads nothing unreadable as off', async () => {
    const database = { query: jest.fn() };
    const service = () => new SemanticAssistantAccessService(database as never);
    database.query.mockResolvedValueOnce({ rows: [{ value: {} }] });
    await expect(service().get()).resolves.toEqual({ enforcePermissions: true });
    database.query.mockResolvedValueOnce({ rows: [{ value: { enforcePermissions: false } }] });
    await expect(service().get()).resolves.toEqual({ enforcePermissions: false });
    database.query.mockRejectedValueOnce(new Error('column does not exist'));
    await expect(service().get()).resolves.toEqual({ enforcePermissions: true });
  });

  it('stores the choice and serves it at once', async () => {
    const database = { query: jest.fn().mockResolvedValue({ rows: [] }) };
    const service = new SemanticAssistantAccessService(database as never);
    await service.update('u1', { enforcePermissions: false });
    expect(database.query).toHaveBeenCalledWith(expect.stringContaining('assistant_settings'), ['{"enforcePermissions":false}', 'u1']);
    await expect(service.get()).resolves.toEqual({ enforcePermissions: false });
    expect(database.query).toHaveBeenCalledTimes(1);
  });
});
