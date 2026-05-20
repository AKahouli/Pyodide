import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConversationV2SessionService } from './conversation-v2-session.service';
import { ConversationV2Session } from '../schemas/conversation-v2-session.schema';

function model() {
  return {
    create: jest.fn(),
    find: jest.fn().mockReturnThis(),
    findOne: jest.fn().mockReturnThis(),
    findOneAndUpdate: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn(),
  };
}

describe('ConversationV2SessionService', () => {
  let svc: ConversationV2SessionService;
  let m: ReturnType<typeof model>;

  beforeEach(async () => {
    m = model();
    const mod = await Test.createTestingModule({
      providers: [
        ConversationV2SessionService,
        { provide: getModelToken(ConversationV2Session.name), useValue: m },
      ],
    }).compile();
    svc = mod.get(ConversationV2SessionService);
  });

  it('upserts a pointer on createForUser', async () => {
    m.findOneAndUpdate.mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve({ sessionId: 's1', ownerId: 'u1' }) }),
    });
    const r = await svc.createForUser('u1', 's1');
    expect(m.findOneAndUpdate).toHaveBeenCalledWith(
      { sessionId: 's1' },
      expect.objectContaining({ $setOnInsert: expect.objectContaining({ ownerId: 'u1', sessionId: 's1' }) }),
      { upsert: true, new: true },
    );
    expect(r.sessionId).toBe('s1');
  });

  it('list filters by owner, excludes soft-deleted, sorts desc by lastEventAt', async () => {
    m.find.mockReturnThis();
    m.exec.mockResolvedValue([{ sessionId: 'a' }]);
    await svc.list('u1', { limit: 20 });
    expect(m.find).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: 'u1', deletedAt: null }),
    );
    expect(m.sort).toHaveBeenCalledWith({ lastEventAt: -1 });
    expect(m.limit).toHaveBeenCalledWith(20);
  });

  it('softDelete sets deletedAt', async () => {
    m.findOneAndUpdate.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve({}) }) });
    await svc.softDelete('u1', 's1');
    expect(m.findOneAndUpdate).toHaveBeenCalledWith(
      { sessionId: 's1', ownerId: 'u1', deletedAt: null },
      expect.objectContaining({ $set: expect.objectContaining({ deletedAt: expect.any(Date) }) }),
      expect.anything(),
    );
  });

  it('rename updates only the title', async () => {
    m.findOneAndUpdate.mockReturnValue({ lean: () => ({ exec: () => Promise.resolve({ title: 'New' }) }) });
    const r = await svc.rename('u1', 's1', 'New');
    expect(r?.title).toBe('New');
  });
});
