import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ConversationV2SessionService } from './conversation-v2-session.service';
import { ConversationV2Session } from '../schemas/conversation-v2-session.schema';

describe('ConversationV2SessionService', () => {
  let svc: ConversationV2SessionService;
  let create: jest.Mock;
  let findOne: jest.Mock;
  let findOneAndUpdate: jest.Mock;
  let updateOne: jest.Mock;
  let deleteOne: jest.Mock;
  let find: jest.Mock;

  beforeEach(async () => {
    create = jest.fn();
    findOne = jest.fn();
    findOneAndUpdate = jest.fn();
    updateOne = jest.fn();
    deleteOne = jest.fn();
    find = jest.fn();

    const mod = await Test.createTestingModule({
      providers: [
        ConversationV2SessionService,
        {
          provide: getModelToken(ConversationV2Session.name),
          useValue: { create, findOne, findOneAndUpdate, updateOne, deleteOne, find },
        },
      ],
    }).compile();

    svc = mod.get(ConversationV2SessionService);
  });

  it('listDeployedApps filters deployed sessions with a URL and maps the DTO', async () => {
    const id = new Types.ObjectId();
    const select = jest.fn().mockReturnValue({
      lean: () => ({
        exec: () =>
          Promise.resolve([
            {
              _id: id,
              title: 'Conversation title',
              deployedAppTitle: 'Generated app',
              deployedUrl: 'https://apps.example/app-1',
              lastDeployedAt: new Date('2026-07-17T10:00:00.000Z'),
            },
          ]),
      }),
    });
    const sort = jest.fn().mockReturnValue({ select });
    find.mockReturnValueOnce({ sort });

    await expect(svc.listDeployedApps('u1')).resolves.toEqual([
      {
        sessionId: id.toString(),
        title: 'Generated app',
        deployedUrl: 'https://apps.example/app-1',
        lastDeployedAt: '2026-07-17T10:00:00.000Z',
        source: 'owned',
        shareId: null,
        canOpenConversation: true,
      },
    ]);
    expect(find).toHaveBeenCalledWith({
      ownerId: 'u1',
      deletedAt: null,
      deployStatus: 'deployed',
      deployedUrl: { $ne: null },
    });
    expect(sort).toHaveBeenCalledWith({ lastDeployedAt: -1 });
    expect(select).toHaveBeenCalledWith(
      'title deployedAppTitle deployedUrl lastDeployedAt',
    );
  });

  it('listDraftApps returns unpublished sessions with activity', async () => {
    const id = new Types.ObjectId();
    const select = jest.fn().mockReturnValue({
      lean: () => ({
        exec: () =>
          Promise.resolve([
            {
              _id: id,
              title: 'Work in progress',
              deployedAppTitle: null,
              deployStatus: 'idle',
              lastEventAt: new Date('2026-07-15T10:00:00.000Z'),
            },
          ]),
      }),
    });
    const sort = jest.fn().mockReturnValue({ select });
    find.mockReturnValueOnce({ sort });

    await expect(svc.listDraftApps('u1')).resolves.toEqual([
      {
        sessionId: id.toString(),
        title: 'Work in progress',
        lastUpdatedAt: '2026-07-15T10:00:00.000Z',
        deployStatus: 'idle',
      },
    ]);
    expect(find).toHaveBeenCalledWith({
      ownerId: 'u1',
      deletedAt: null,
      aiSessionId: { $ne: null },
      eventCount: { $gt: 0 },
      $or: [{ deployStatus: { $ne: 'deployed' } }, { deployedUrl: null }],
    });
    expect(sort).toHaveBeenCalledWith({ lastEventAt: -1 });
    expect(select).toHaveBeenCalledWith('title deployedAppTitle deployStatus lastEventAt');
  });

  it('removeDeployedApp clears deployment state without deleting the conversation', async () => {
    const id = '507f1f77bcf86cd799439011';
    findOneAndUpdate.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve({ _id: id }) }),
    });

    await svc.removeDeployedApp('u1', id);

    expect(findOneAndUpdate).toHaveBeenCalledWith(
      {
        _id: new Types.ObjectId(id),
        ownerId: 'u1',
        deletedAt: null,
        deployStatus: 'deployed',
      },
      {
        $set: {
          deployStatus: 'idle',
          deployedUrl: null,
          deployedAppTitle: null,
          lastDeployedAt: null,
        },
      },
      { new: true },
    );
  });

  it('list filters by owner, excludes soft-deleted, sorts desc by lastEventAt', async () => {
    const limit = jest.fn().mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve([{ _id: new Types.ObjectId(), title: 'a', status: 'active', lastEventAt: new Date(0), isShared: false, workspaceIds: [] }]) }),
    });
    const sort = jest.fn().mockReturnValue({ limit });
    find.mockReturnValueOnce({ sort });

    await svc.list('u1', { limit: 20 } as any);
    expect(find).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'u1', deletedAt: null }),
    );
    expect(sort).toHaveBeenCalledWith({ lastEventAt: -1 });
    expect(limit).toHaveBeenCalledWith(20);
  });

  it('softDelete sets deletedAt', async () => {
    const id = '507f1f77bcf86cd799439011';
    findOneAndUpdate.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve({}) }) });
    await svc.softDelete('u1', id);
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(id), ownerId: 'u1', deletedAt: null },
      expect.objectContaining({ $set: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      expect.anything(),
    );
  });

  it('rename updates only the title', async () => {
    const id = '507f1f77bcf86cd799439011';
    findOneAndUpdate.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve({ title: 'New' }) }) });
    const r = await svc.rename('u1', id, 'New');
    expect(findOneAndUpdate).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(id), ownerId: 'u1', deletedAt: null },
      { $set: { title: 'New' } },
      { new: true },
    );
    expect(r?.title).toBe('New');
  });

  it('getOne returns null for a malformed id without hitting the DB', async () => {
    const result = await svc.getOne('u1', 'not-a-real-id');
    expect(result).toBeNull();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('list maps doc._id to result.sessionId', async () => {
    const id = new Types.ObjectId();
    const limit = jest.fn().mockReturnValue({
      lean: () => ({
        exec: () => Promise.resolve([
          { _id: id, title: 't', status: 'active', lastEventAt: new Date(0), isShared: false, workspaceIds: [] },
        ]),
      }),
    });
    const sort = jest.fn().mockReturnValue({ limit });
    find.mockReturnValueOnce({ sort });

    const result = await svc.list('u1', { limit: 20 } as any);
    expect(result[0].sessionId).toBe(id.toString());
  });

  it('createDraft inserts an empty pointer with aiSessionId=null and returns the new doc', async () => {
    const fakeId = new Types.ObjectId();
    create.mockResolvedValueOnce({ _id: fakeId, ownerId: 'u1', aiSessionId: null });

    const doc = await svc.createDraft('u1', ['ws-a']);

    expect(doc._id).toBe(fakeId);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: 'u1',
        aiSessionId: null,
        title: '',
        status: 'active',
        isShared: false,
        shareTokenHash: null,
        deletedAt: null,
        workspaceIds: ['ws-a'],
        eventSequence: 0,
        eventCount: 0,
        systemWorkspaceId: null,
      }),
    );
  });

  it('attachAiSession only patches docs whose aiSessionId is still null', async () => {
    const id = new Types.ObjectId();
    updateOne.mockResolvedValueOnce({ matchedCount: 1 });
    await svc.attachAiSession(id, 'ai-session-1', '507f1f77bcf86cd799439011');

    expect(updateOne).toHaveBeenCalledWith(
      { _id: id, aiSessionId: null },
      {
        $set: {
          aiSessionId: 'ai-session-1',
          systemWorkspaceId: expect.any(Types.ObjectId),
        },
      },
    );
  });

  it('deleteDraft only removes docs that are still drafts (aiSessionId null AND deletedAt null)', async () => {
    const id = new Types.ObjectId();
    deleteOne.mockResolvedValueOnce({ deletedCount: 1 });
    await svc.deleteDraft(id);

    expect(deleteOne).toHaveBeenCalledWith({
      _id: id,
      aiSessionId: null,
      deletedAt: null,
    });
  });

  it('findByAiSessionId looks up a live pointer by APImanus session id', async () => {
    const doc = { _id: new Types.ObjectId(), aiSessionId: '72e7924c2cc04f5f' };
    findOne.mockReturnValueOnce({
      lean: () => ({ exec: () => Promise.resolve(doc) }),
    });

    await expect(svc.findByAiSessionId('72e7924c2cc04f5f')).resolves.toEqual(doc);
    expect(findOne).toHaveBeenCalledWith({
      aiSessionId: '72e7924c2cc04f5f',
      deletedAt: null,
    });
  });
});
