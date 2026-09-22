import { newObjectId } from '@common/postgres/object-id';
import { NotFoundException } from '../exceptions';
import { ConnectorCredentialService } from './connector-credential.service';

describe('ConnectorCredentialService', () => {
  const now = new Date();
  const row = (over: Record<string, unknown> = {}) => ({
    id: newObjectId(), connectorId: newObjectId(), displayName: 'cred', status: 'active', authPayload: { secret: 's' },
    lastValidatedAt: null, expiresAt: null, userId: 'u1', createdAt: now, updatedAt: now, ...over,
  });
  let store: Record<string, jest.Mock>;
  let service: ConnectorCredentialService;

  beforeEach(() => {
    store = {
      insert: jest.fn(async (r: any) => row(r)), list: jest.fn().mockResolvedValue([]), findByIdAndUser: jest.fn(),
      findActiveFor: jest.fn(), update: jest.fn(), deleteByIdAndUser: jest.fn(),
    };
    service = new ConnectorCredentialService(store as never, { setContext: jest.fn(), log: jest.fn() } as never);
  });

  it('create stores as active for the user and never returns the auth payload', async () => {
    const res = await service.create('u1', { connectorId: 'c', displayName: 'n', authPayload: { secret: 'x' }, expiresAt: '2030-01-01T00:00:00Z' } as never);
    expect(store.insert).toHaveBeenCalledWith(expect.objectContaining({ status: 'active', userId: 'u1', expiresAt: new Date('2030-01-01T00:00:00Z') }));
    expect(res).not.toHaveProperty('authPayload');
  });

  it('findAllForUser forwards the filters', async () => {
    await service.findAllForUser('u1', { connectorId: 'c', status: 'active' });
    expect(store.list).toHaveBeenCalledWith({ userId: 'u1', connectorId: 'c', status: 'active' });
  });

  it('findById / update / delete / validate 404 when the credential is not owned by the caller', async () => {
    store.findByIdAndUser.mockResolvedValue(null);
    store.deleteByIdAndUser.mockResolvedValue(null);
    await expect(service.findById('i', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update('i', 'u1', {} as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete('i', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.validateCredential('i', 'u1')).rejects.toBeInstanceOf(NotFoundException);
    expect(store.update).not.toHaveBeenCalled();
  });

  it('update patches only provided fields', async () => {
    store.findByIdAndUser.mockResolvedValue(row());
    store.update.mockImplementation(async (_id: string, p: any) => row(p));
    await service.update('i', 'u1', { displayName: 'new' } as never);
    expect(store.update).toHaveBeenCalledWith('i', { displayName: 'new' });
  });

  it('validateCredential flags expired credentials and keeps live ones active', async () => {
    store.update.mockImplementation(async (_id: string, p: any) => row(p));
    store.findByIdAndUser.mockResolvedValue(row({ expiresAt: new Date(Date.now() - 1000) }));
    expect((await service.validateCredential('i', 'u1')).status).toBe('expired');
    store.findByIdAndUser.mockResolvedValue(row({ expiresAt: new Date(Date.now() + 100000) }));
    expect((await service.validateCredential('i', 'u1')).status).toBe('active');
  });
});
