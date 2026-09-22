import { projectRowToRecord, projectShareRowToRecord } from './project-record.mapper';

const at = new Date('2026-09-11T10:00:00.000Z');

describe('project record mappers (public JSON shape)', () => {
  it('project: exact keys, id present, no _id/__v', () => {
    const json = JSON.parse(
      JSON.stringify(
        projectRowToRecord({
          id: '61a1b2c3d4e5f6a7b8c9d0e3',
          name: 'P',
          createdBy: '61a1b2c3d4e5f6a7b8c9d0e1',
          isPublic: false,
          shareCount: 2,
          createdAt: at,
          updatedAt: at,
        } as never),
      ),
    );
    expect(Object.keys(json).sort()).toEqual([
      'createdAt',
      'createdBy',
      'id',
      'isPublic',
      'name',
      'shareCount',
      'updatedAt',
    ]);
    expect(json).not.toHaveProperty('_id');
    expect(json).not.toHaveProperty('__v');
    expect(json.createdAt).toBe('2026-09-11T10:00:00.000Z');
  });

  it('project share: exact keys, id present, no _id/__v', () => {
    const json = JSON.parse(
      JSON.stringify(
        projectShareRowToRecord({
          id: '61a1b2c3d4e5f6a7b8c9d0e4',
          projectId: '61a1b2c3d4e5f6a7b8c9d0e3',
          ownerId: '61a1b2c3d4e5f6a7b8c9d0e1',
          sharedWithUserId: '61a1b2c3d4e5f6a7b8c9d0e2',
          permission: 'read',
          sharedBy: '61a1b2c3d4e5f6a7b8c9d0e1',
          createdAt: at,
          updatedAt: at,
        } as never),
      ),
    );
    expect(Object.keys(json).sort()).toEqual([
      'createdAt',
      'id',
      'ownerId',
      'permission',
      'projectId',
      'sharedBy',
      'sharedWithUserId',
      'updatedAt',
    ]);
    expect(json).not.toHaveProperty('_id');
    expect(json).not.toHaveProperty('__v');
  });
});
