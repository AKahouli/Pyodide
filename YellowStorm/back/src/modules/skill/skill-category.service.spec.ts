import { newObjectId } from '@common/postgres/object-id';
import { ConflictException, ForbiddenException, NotFoundException } from '../exceptions';
import { SkillCategoryService } from './skill-category.service';

describe('SkillCategoryService', () => {
  const now = new Date();
  const row = (over: Record<string, unknown> = {}) => ({
    id: newObjectId(), name: 'Writing', description: 'd', isSystem: false, createdAt: now, updatedAt: now, ...over,
  });
  let store: Record<string, jest.Mock>;
  let service: SkillCategoryService;

  beforeEach(() => {
    store = {
      ensureSystem: jest.fn(), findByNameInsensitive: jest.fn().mockResolvedValue(null), insert: jest.fn(async (r: any) => row(r)),
      findAll: jest.fn().mockResolvedValue([]), findById: jest.fn(), update: jest.fn(), delete: jest.fn(),
    };
    service = new SkillCategoryService(store as never);
  });

  it('ensures the System category on boot', async () => {
    await service.onModuleInit();
    expect(store.ensureSystem).toHaveBeenCalledWith(expect.objectContaining({ name: 'System' }));
  });

  it('create rejects the reserved name and case-insensitive duplicates', async () => {
    await expect(service.create({ name: 'SYSTEM' } as never)).rejects.toBeInstanceOf(ConflictException);
    store.findByNameInsensitive.mockResolvedValue(row());
    await expect(service.create({ name: 'writing' } as never)).rejects.toBeInstanceOf(ConflictException);
    expect(store.insert).not.toHaveBeenCalled();
  });

  it('create inserts with default description', async () => {
    await service.create({ name: 'Docs' } as never);
    expect(store.insert).toHaveBeenCalledWith({ name: 'Docs', description: '' });
  });

  it('findById 404s on invalid id and missing row', async () => {
    await expect(service.findById('x')).rejects.toBeInstanceOf(NotFoundException);
    store.findById.mockResolvedValue(null);
    await expect(service.findById(newObjectId())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update forbids system, reserved rename and name conflicts; succeeds otherwise', async () => {
    const id = newObjectId();
    store.findById.mockResolvedValue(row({ id, isSystem: true }));
    await expect(service.update(id, { name: 'A' } as never)).rejects.toBeInstanceOf(ForbiddenException);

    store.findById.mockResolvedValue(row({ id }));
    await expect(service.update(id, { name: 'system' } as never)).rejects.toBeInstanceOf(ConflictException);
    store.findByNameInsensitive.mockResolvedValue(row({ id: newObjectId() }));
    await expect(service.update(id, { name: 'Other' } as never)).rejects.toBeInstanceOf(ConflictException);

    store.findByNameInsensitive.mockResolvedValue(null);
    store.update.mockResolvedValue(row({ id, name: 'Other' }));
    expect((await service.update(id, { name: 'Other' } as never)).name).toBe('Other');
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
