import { Types } from 'mongoose';
import { SkillService } from './skill.service';
import { SKILL_STORE } from './persistence/skill.store';

describe('SkillService slug identity', () => {
  const ownerId = new Types.ObjectId().toString();
  const skillStore = {
    findByOwnerNameOrSlug: jest.fn(),
    insert: jest.fn(),
  };

  const service = new SkillService(
    skillStore as never,
    {} as never,
    { setContext: jest.fn() } as never,
  );

  beforeEach(() => jest.clearAllMocks());

  it('defaults a new skill slug to its name', async () => {
    skillStore.findByOwnerNameOrSlug.mockResolvedValue(null);
    skillStore.insert.mockImplementation(async (input: Record<string, unknown>) => ({
      ...input,
      id: new Types.ObjectId().toString(),
      files: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const created = await service.create(ownerId, {
      name: 'document-search',
      description: 'Search documents',
    });

    expect(skillStore.insert).toHaveBeenCalledWith(expect.objectContaining({ slug: 'document-search' }));
    expect(created.slug).toBe('document-search');
  });
});
