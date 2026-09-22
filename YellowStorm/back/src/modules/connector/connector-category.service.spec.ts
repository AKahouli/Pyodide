import { newObjectId } from '@common/postgres/object-id';
import { ConflictException, ForbiddenException, NotFoundException } from '../exceptions';
import { ConnectorCategoryService } from './connector-category.service';

describe('ConnectorCategoryService', () => {
  const now = new Date();
  const row = (over: Record<string, unknown> = {}) => ({
    id: newObjectId(), name: 'Mail', description: 'd', isSystem: false, createdBy: newObjectId(), createdAt: now, updatedAt: now, ...over,
  });
  let store: Record<string, jest.Mock>;
  let service: ConnectorCategoryService;

  beforeEach(() => {
    store = {
      ensureSystem: jest.fn(), findByOwnerName: jest.fn().mockResolvedValue(null), insert: jest.fn(async (r: any) => row(r)),
      findAll: jest.fn().mockResolvedValue([]), findById: jest.fn(), update: jest.fn(), delete: jest.fn(),
    };
    service = new ConnectorCategoryService(store as never);
  });

  it('ensures the System category on boot', async () => {
    await service.onModuleInit();
    expect(store.ensureSystem).toHaveBeenCalledWith('System', '000000000000000000000000', expect.any(String));
  });

  it('create rejects the reserved name (any case) and per-owner duplicates', async () => {
    await expect(service.create('u', { name: ' system ' } as never)).rejects.toBeInstanceOf(ConflictException);
    store.findByOwnerName.mockResolvedValue(row());
    await expect(service.create('u', { name: 'Mail' } as never)).rejects.toBeInstanceOf(ConflictException);
    expect(store.insert).not.toHaveBeenCalled();
  });

  it('create inserts with owner and default description', async () => {
    const res = await service.create('owner-1', { name: 'Docs' } as never);
    expect(store.insert).toHaveBeenCalledWith({ name: 'Docs', description: '', createdBy: 'owner-1' });
    expect(res.name).toBe('Docs');
  });

  it('findById 404s on invalid id and missing row', async () => {
    await expect(service.findById('x')).rejects.toBeInstanceOf(NotFoundException);
    store.findById.mockResolvedValue(null);
    await expect(service.findById(newObjectId())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update forbids system category, reserved rename and sibling-name conflicts', async () => {
    const id = newObjectId();
    store.findById.mockResolvedValue(row({ id, isSystem: true }));
    await expect(service.update(id, { name: 'A' } as never)).rejects.toBeInstanceOf(ForbiddenException);

    store.findById.mockResolvedValue(row({ id }));
    await expect(service.update(id, { name: 'System' } as never)).rejects.toBeInstanceOf(ConflictException);

    store.findByOwnerName.mockResolvedValue(row({ id: newObjectId() }));
    await expect(service.update(id, { name: 'Other' } as never)).rejects.toBeInstanceOf(ConflictException);
  });

  it('update writes through and 404s when the row vanished', async () => {
    const id = newObjectId();
    store.findById.mockResolvedValue(row({ id }));
    store.update.mockResolvedValue(row({ id, name: 'New' }));
    expect((await service.update(id, { name: 'New' } as never)).name).toBe('New');
    store.update.mockResolvedValue(null);
    await expect(service.update(id, { description: 'x' } as never)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('delete forbids system, 404s on missing, deletes otherwise', async () => {
    const id = newObjectId();
    store.findById.mockResolvedValue(row({ id, isSystem: true }));
    await expect(service.delete(id)).rejects.toBeInstanceOf(ForbiddenException);
    store.findById.mockResolvedValue(null);
    await expect(service.delete(id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete('bad')).rejects.toBeInstanceOf(NotFoundException);
    store.findById.mockResolvedValue(row({ id }));
    await service.delete(id);
    expect(store.delete).toHaveBeenCalledWith(id);
  });
});
