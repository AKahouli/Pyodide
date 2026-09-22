import { ErrorCode } from '../exceptions/constants/error-codes';
import { ProjectService } from './project.service';

const now = new Date('2026-09-11T10:00:00.000Z');
const OWNER_ID = '61a1b2c3d4e5f6a7b8c9d0e1';
const PROJECT_ID = '61a1b2c3d4e5f6a7b8c9d0e3';

function makeService(projectStore: Record<string, jest.Mock>) {
  const conversationStore = { countByProject: jest.fn().mockResolvedValue(0), countByProjects: jest.fn() };
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn() };
  return new ProjectService(projectStore as never, conversationStore as never, {} as never, logger as never);
}

const record = {
  id: PROJECT_ID,
  name: 'P',
  createdBy: OWNER_ID,
  isPublic: false,
  shareCount: 0,
  createdAt: now,
  updatedAt: now,
};

describe('ProjectService', () => {
  it('maps a create race on uq_projects_owner_name to PROJECT_ALREADY_EXISTS', async () => {
    const dup = Object.assign(new Error('Failed query'), {
      cause: { code: '23505', constraint: 'uq_projects_owner_name' },
    });
    const service = makeService({
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockRejectedValue(dup),
    });
    await expect(service.create(OWNER_ID, { name: 'P' })).rejects.toMatchObject({
      code: ErrorCode.PROJECT_ALREADY_EXISTS,
    });
  });

  it('rethrows unrelated create errors', async () => {
    const service = makeService({
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockRejectedValue(new Error('boom')),
    });
    await expect(service.create(OWNER_ID, { name: 'P' })).rejects.toThrow('boom');
  });

  it('normalizes uppercase project ids', async () => {
    const findById = jest.fn().mockResolvedValue(record);
    const service = makeService({ findById });
    await service.findById(OWNER_ID, PROJECT_ID.toUpperCase());
    expect(findById).toHaveBeenCalledWith(PROJECT_ID);
  });
});
