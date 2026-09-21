import { newObjectId } from '@common/postgres/object-id';
import { BadRequestException, ConflictException, NotFoundException } from '../exceptions';
import { ToolService } from './tool.service';
import { ToolAttributeType } from './tool.types';

describe('ToolService', () => {
  const now = new Date();
  const row = (over: Record<string, unknown> = {}) => ({
    id: newObjectId(), name: 'search', description: '', icon: '', color: '', iconColor: 'light', categoryId: null,
    defaultAgentTypes: [], attributes: [], requiredAppKey: null, isActive: true, createdAt: now, updatedAt: now, ...over,
  });
  let store: Record<string, jest.Mock>;
  let service: ToolService;

  beforeEach(() => {
    store = {
      findByName: jest.fn().mockResolvedValue(null), insert: jest.fn(async (r: any) => row(r)), list: jest.fn(),
      findById: jest.fn(), update: jest.fn(), delete: jest.fn(), findByAgentType: jest.fn(), findAllActive: jest.fn(), findByIds: jest.fn(),
    };
    service = new ToolService(store as never, { setContext: jest.fn(), log: jest.fn() } as never);
  });

  it('create conflicts on duplicate name and normalises empty requiredAppKey to null', async () => {
    store.findByName.mockResolvedValue(row());
    await expect(service.create({ name: 'search' } as never)).rejects.toBeInstanceOf(ConflictException);
    store.findByName.mockResolvedValue(null);
    await service.create({ name: 'n', requiredAppKey: '' } as never);
    expect(store.insert).toHaveBeenCalledWith(expect.objectContaining({ requiredAppKey: null, isActive: true, iconColor: 'light' }));
  });

  it('validates attribute values against their declared type', async () => {
    const attr = (over: Record<string, unknown>) => ({ name: 'a', type: ToolAttributeType.STRING, value: 'v', ...over });
    const create = (attributes: unknown[]) => service.create({ name: 'n', attributes } as never);
    await expect(create([attr({ value: 1 })])).rejects.toBeInstanceOf(BadRequestException);
    await expect(create([attr({ type: ToolAttributeType.NUMBER, value: 'x' })])).rejects.toBeInstanceOf(BadRequestException);
    await expect(create([attr({ type: ToolAttributeType.BOOLEAN, value: 'true' })])).rejects.toBeInstanceOf(BadRequestException);
    await expect(create([attr({ type: ToolAttributeType.ENUM, value: 'a' })])).rejects.toBeInstanceOf(BadRequestException);
    await expect(create([attr({ type: ToolAttributeType.ENUM, value: 'z', options: ['a', 'b'] })])).rejects.toBeInstanceOf(BadRequestException);
    await expect(create([attr({}), attr({})])).rejects.toBeInstanceOf(BadRequestException);
    await expect(create([attr({ type: ToolAttributeType.ENUM, value: 'a', options: ['a'] })])).resolves.toBeDefined();
  });

  it('findAll paginates with defaults', async () => {
    store.list.mockResolvedValue({ rows: [row()], total: 1 });
    await service.findAll({} as never);
    expect(store.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, limit: 10 }));
  });

  it('findById / update / delete 404 for unknown tools', async () => {
    store.findById.mockResolvedValue(null);
    store.delete.mockResolvedValue(null);
    await expect(service.findById('x')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.update('x', {} as never)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.delete('x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('update rejects renaming onto an existing tool and clears empty categoryId / requiredAppKey', async () => {
    const cur = row();
    store.findById.mockResolvedValue(cur);
    store.findByName.mockResolvedValue(row());
    await expect(service.update(cur.id, { name: 'other' } as never)).rejects.toBeInstanceOf(ConflictException);
    store.update.mockResolvedValue(cur);
    await service.update(cur.id, { categoryId: '', requiredAppKey: '' } as never);
    expect(store.update).toHaveBeenCalledWith(cur.id, { categoryId: null, requiredAppKey: null });
  });
});
