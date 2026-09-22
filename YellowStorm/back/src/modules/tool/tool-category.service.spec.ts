import { newObjectId } from '@common/postgres/object-id';
import { ConflictException, NotFoundException } from '../exceptions';
import { ToolCategoryService } from './tool-category.service';

describe('ToolCategoryService', () => {
  const now = new Date();
  const row = (over: Record<string, unknown> = {}) => ({ id: newObjectId(), name: 'Web', description: '', createdAt: now, updatedAt: now, ...over });
  let store: Record<string, jest.Mock>;
  let service: ToolCategoryService;

  beforeEach(() => {
    store = {
      findByName: jest.fn().mockResolvedValue(null), insert: jest.fn(async (r: any) => row(r)),
      findAll: jest.fn().mockResolvedValue([]), findById: jest.fn(), update: jest.fn(), delete: jest.fn(),
    };
    service = new ToolCategoryService(store as never);
  });

  it('create conflicts on duplicate name, otherwise inserts with default description', async () => {
    store.findByName.mockResolvedValue(row());
    await expect(service.create({ name: 'Web' } as never)).rejects.toBeInstanceOf(ConflictException);
    store.findByName.mockResolvedValue(null);
    await service.create({ name: 'New' } as never);
    expect(store.insert).toHaveBeenCalledWith({ name: 'New', description: '' });
  });

  it('findById / update / delete 404 on invalid ids and missing rows', async () => {
    await expect(service.findById('bad')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update('bad', {} as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete('bad')).rejects.toBeInstanceOf(NotFoundException);
    store.findById.mockResolvedValue(null);
    store.delete.mockResolvedValue(false);
    await expect(service.findById(newObjectId())).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update(newObjectId(), {} as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete(newObjectId())).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update conflicts when renaming onto another category, allows keeping the same name', async () => {
    const cur = row();
    store.findById.mockResolvedValue(cur);
    store.findByName.mockResolvedValue(row({ id: newObjectId() }));
    await expect(service.update(cur.id, { name: 'Taken' } as never)).rejects.toBeInstanceOf(ConflictException);
    store.update.mockResolvedValue(cur);
    await expect(service.update(cur.id, { name: cur.name } as never)).resolves.toMatchObject({ id: cur.id });
  });
});
