import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { UserGroupService } from './user-group.service';
import { UserGroup } from './schemas/user-group.schema';
import { LoggerService } from '../logger';

const OWNER = new Types.ObjectId().toString();
const OTHER = new Types.ObjectId().toString();
const MEMBER_A = new Types.ObjectId().toString();
const MEMBER_B = new Types.ObjectId().toString();

/** A populated member doc, as mongoose returns after .populate(). */
function memberDoc(id: string, email: string) {
  return { _id: new Types.ObjectId(id), email, profile: { firstName: 'F', lastName: 'L' } };
}

/** Build a lean group object mimicking a populated find result. */
function leanGroup(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    _id: new Types.ObjectId(),
    name: 'My Group',
    description: '',
    members: [],
    createdBy: new Types.ObjectId(OWNER),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('UserGroupService', () => {
  let service: UserGroupService;
  let model: any;

  beforeEach(async () => {
    model = {
      findOne: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      updateOne: jest.fn(),
      findByIdAndDelete: jest.fn(),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        UserGroupService,
        { provide: getModelToken(UserGroup.name), useValue: model },
        { provide: LoggerService, useValue: { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(UserGroupService);
  });

  describe('create', () => {
    it('rejects a duplicate name for the same owner', async () => {
      model.findOne.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(leanGroup()) }) });
      await expect(service.create(OWNER, { name: 'My Group' })).rejects.toBeInstanceOf(ConflictException);
    });

    it('creates a group and returns a mapped response with memberCount', async () => {
      model.findOne.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve(null) }) });
      const created = leanGroup({ name: 'New', members: [new Types.ObjectId(MEMBER_A)] });
      // create() returns a doc; then service re-fetches populated:
      model.create.mockResolvedValue({ _id: created._id });
      model.findById.mockReturnValue({
        populate: () => ({ lean: () => ({ exec: () => Promise.resolve({ ...created, members: [memberDoc(MEMBER_A, 'a@x.io')] }) }) }),
      });

      const res = await service.create(OWNER, { name: 'New', memberIds: [MEMBER_A] });
      expect(res.name).toBe('New');
      expect(res.memberCount).toBe(1);
      expect(res.members[0]).toEqual({ id: MEMBER_A, email: 'a@x.io', firstName: 'F', lastName: 'L' });
    });
  });

  describe('findById', () => {
    it('throws NotFound when the group belongs to another user', async () => {
      model.findById.mockReturnValue({
        populate: () => ({ lean: () => ({ exec: () => Promise.resolve(leanGroup({ createdBy: new Types.ObjectId(OTHER) })) }) }),
      });
      await expect(service.findById(OWNER, new Types.ObjectId().toString())).rejects.toBeInstanceOf(NotFoundException);
    });

    it('throws NotFound for a malformed id', async () => {
      await expect(service.findById(OWNER, 'not-an-id')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('addMembers', () => {
    it('adds members idempotently via $addToSet and returns the populated group', async () => {
      const id = new Types.ObjectId().toString();
      model.findById
        .mockReturnValueOnce({ exec: () => Promise.resolve({ _id: new Types.ObjectId(id), createdBy: new Types.ObjectId(OWNER) }) })
        .mockReturnValueOnce({
          populate: () => ({ lean: () => ({ exec: () => Promise.resolve(leanGroup({ members: [memberDoc(MEMBER_A, 'a@x.io'), memberDoc(MEMBER_B, 'b@x.io')] })) }) }),
        });
      model.updateOne.mockReturnValue({ exec: () => Promise.resolve({ modifiedCount: 1 }) });

      const res = await service.addMembers(OWNER, id, [MEMBER_A, MEMBER_B]);
      expect(model.updateOne).toHaveBeenCalledWith(
        { _id: expect.anything() },
        { $addToSet: { members: { $each: expect.any(Array) } } },
      );
      expect(res.memberCount).toBe(2);
    });

    it('throws Forbidden when a non-owner tries to add members', async () => {
      const id = new Types.ObjectId().toString();
      model.findById.mockReturnValue({ exec: () => Promise.resolve({ _id: new Types.ObjectId(id), createdBy: new Types.ObjectId(OTHER) }) });
      await expect(service.addMembers(OWNER, id, [MEMBER_A])).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('removeMember', () => {
    it('pulls the member and returns the populated group', async () => {
      const id = new Types.ObjectId().toString();
      model.findById
        .mockReturnValueOnce({ exec: () => Promise.resolve({ _id: new Types.ObjectId(id), createdBy: new Types.ObjectId(OWNER) }) })
        .mockReturnValueOnce({ populate: () => ({ lean: () => ({ exec: () => Promise.resolve(leanGroup({ members: [] })) }) }) });
      model.updateOne.mockReturnValue({ exec: () => Promise.resolve({ modifiedCount: 1 }) });

      const res = await service.removeMember(OWNER, id, MEMBER_A);
      expect(model.updateOne).toHaveBeenCalledWith({ _id: expect.anything() }, { $pull: { members: expect.anything() } });
      expect(res.memberCount).toBe(0);
    });
  });
});
