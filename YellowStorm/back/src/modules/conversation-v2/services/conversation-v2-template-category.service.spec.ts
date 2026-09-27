import { ConflictException, NotFoundException } from '@modules/exceptions';
import { ConversationV2TemplateCategoryService } from './conversation-v2-template-category.service';

describe('ConversationV2TemplateCategoryService', () => {
  const findBySlug = jest.fn();
  const findByNameInsensitive = jest.fn();
  const findById = jest.fn();
  const findAll = jest.fn();
  const insert = jest.fn();
  const update = jest.fn();
  const deleteCategory = jest.fn();
  const countTemplatesByCategoryIds = jest.fn();
  const findByCategoryId = jest.fn();
  const removeTemplateArtifacts = jest.fn();

  let svc: ConversationV2TemplateCategoryService;

  beforeEach(() => {
    jest.clearAllMocks();
    findBySlug.mockResolvedValue(null);
    findByNameInsensitive.mockResolvedValue(null);
    countTemplatesByCategoryIds.mockResolvedValue(new Map());
    removeTemplateArtifacts.mockResolvedValue(undefined);
    findByCategoryId.mockResolvedValue([]);

    svc = new ConversationV2TemplateCategoryService(
      {
        findBySlug,
        findByNameInsensitive,
        findById,
        findAll,
        insert,
        update,
        delete: deleteCategory,
        countTemplatesByCategoryIds,
      },
      { findByCategoryId } as never,
      { removeTemplateArtifacts } as never,
    );
  });

  it('creates a category with a slug derived from the name', async () => {
    insert.mockResolvedValueOnce({
      id: 'c1',
      name: 'Productivity',
      slug: 'productivity',
      icon: '⚡',
      createdAt: new Date(0),
      updatedAt: new Date(0),
    });

    const result = await svc.create({ name: 'Productivity', icon: '⚡' });

    expect(insert).toHaveBeenCalledWith({
      name: 'Productivity',
      slug: 'productivity',
      icon: '⚡',
    });
    expect(result).toMatchObject({ id: 'c1', slug: 'productivity', templateCount: 0 });
  });

  it('rejects a duplicate slug or name', async () => {
    findBySlug.mockResolvedValueOnce({ id: 'c0' } as never);
    await expect(svc.create({ name: 'Productivity' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('lists categories with their template counts', async () => {
    findAll.mockResolvedValueOnce([
      { id: 'c1', name: 'A', slug: 'a', icon: '', createdAt: new Date(0), updatedAt: new Date(0) },
    ]);
    countTemplatesByCategoryIds.mockResolvedValueOnce(new Map([['c1', 3]]));

    const result = await svc.findAll();
    expect(result[0].templateCount).toBe(3);
  });

  it('cascades a delete and cleans the templates Ceph artifacts', async () => {
    findById.mockResolvedValueOnce({ id: 'c1', name: 'A', slug: 'a', icon: '' });
    findByCategoryId.mockResolvedValueOnce([{ id: 't1', coverImage: 'cover' }]);
    deleteCategory.mockResolvedValueOnce(true);

    await svc.delete('c1');

    expect(deleteCategory).toHaveBeenCalledWith('c1');
    expect(removeTemplateArtifacts).toHaveBeenCalledWith([{ id: 't1', coverImage: 'cover' }]);
  });

  it('rejects an invalid category id', async () => {
    await expect(svc.findById('not-an-id')).rejects.toBeInstanceOf(NotFoundException);
  });
});
