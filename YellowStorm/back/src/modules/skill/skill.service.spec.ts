import { Types } from 'mongoose';
import { SkillService } from './skill.service';

describe('SkillService slug identity', () => {
  const ownerId = new Types.ObjectId();
  const skillModel = {
    findOne: jest.fn(),
    create: jest.fn(),
    updateMany: jest.fn(),
  };
  const service = new SkillService(
    skillModel as never,
    {} as never,
    {} as never,
    {} as never,
    { setContext: jest.fn() } as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('backfills missing slugs from the existing skill name', async () => {
    const exec = jest.fn().mockResolvedValue({ modifiedCount: 2 });
    skillModel.updateMany.mockReturnValue({ exec });

    await service.onModuleInit();

    expect(skillModel.updateMany).toHaveBeenCalledWith(
      { $or: [{ slug: { $exists: false } }, { slug: '' }] },
      [{ $set: { slug: '$name' } }],
    );
    expect(exec).toHaveBeenCalled();
  });

  it('defaults a new skill slug to its name', async () => {
    skillModel.findOne.mockReturnValue({ lean: () => ({ exec: jest.fn().mockResolvedValue(null) }) });
    skillModel.create.mockImplementation(async (input: Record<string, unknown>) => ({
      ...input,
      _id: new Types.ObjectId(),
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const created = await service.create(ownerId.toString(), {
      name: 'document-search',
      description: 'Search documents',
    });

    expect(skillModel.create).toHaveBeenCalledWith(expect.objectContaining({ slug: 'document-search' }));
    expect(created.slug).toBe('document-search');
  });
});
