// back/src/modules/conversation-v2/services/conversation-v2-pointer-writer.service.spec.ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ConversationV2PointerWriterService } from './conversation-v2-pointer-writer.service';
import { ConversationV2Session } from '../schemas/conversation-v2-session.schema';
import type { ConversationV2Event } from '../types/conversation-v2.types';

describe('ConversationV2PointerWriterService', () => {
  let svc: ConversationV2PointerWriterService;
  let updateOne: jest.Mock;
  const SESSION_HEX = '507f1f77bcf86cd799439011';

  beforeEach(async () => {
    updateOne = jest.fn().mockResolvedValue({});
    const mod = await Test.createTestingModule({
      providers: [
        ConversationV2PointerWriterService,
        {
          provide: getModelToken(ConversationV2Session.name),
          useValue: { updateOne },
        },
      ],
    }).compile();
    svc = mod.get(ConversationV2PointerWriterService);
  });

  function ev(type: ConversationV2Event['type'], extra: Partial<ConversationV2Event['payload']> = {}): ConversationV2Event {
    return {
      type,
      payload: { event_id: 'e1', timestamp: 1700000000, ...extra },
    } as ConversationV2Event;
  }

  it('TitleEvent updates pointer title', async () => {
    await svc.apply(SESSION_HEX, ev('title', { title: 'My Run' } as any));
    expect(updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(SESSION_HEX) },
      { $set: expect.objectContaining({ title: 'My Run', lastEventAt: expect.any(Date) }) },
    );
  });

  it('DoneEvent flips status to completed', async () => {
    await svc.apply(SESSION_HEX, ev('done'));
    expect(updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(SESSION_HEX) },
      { $set: expect.objectContaining({ status: 'completed' }) },
    );
  });

  it('WaitEvent flips status to waiting', async () => {
    await svc.apply(SESSION_HEX, ev('wait'));
    expect(updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(SESSION_HEX) },
      { $set: expect.objectContaining({ status: 'waiting' }) },
    );
  });

  it('ErrorEvent flips status to error', async () => {
    await svc.apply(SESSION_HEX, ev('error', { error: 'boom' } as any));
    expect(updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(SESSION_HEX) },
      { $set: expect.objectContaining({ status: 'error' }) },
    );
  });

  it('MessageEvent only bumps lastEventAt', async () => {
    await svc.apply(SESSION_HEX, ev('message', { role: 'assistant', content: 'hi' } as any));
    expect(updateOne).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(SESSION_HEX) },
      { $set: { lastEventAt: expect.any(Date) } },
    );
  });

  it('swallows update errors (best effort)', async () => {
    updateOne.mockRejectedValueOnce(new Error('mongo down'));
    await expect(svc.apply(SESSION_HEX, ev('done'))).resolves.toBeUndefined();
  });

  it('no-ops when sessionId is not a valid ObjectId hex', async () => {
    await svc.apply('not-a-hex', ev('done'));
    expect(updateOne).not.toHaveBeenCalled();
  });
});
