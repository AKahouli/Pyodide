// back/src/modules/conversation-v2/services/conversation-v2-pointer-writer.service.spec.ts
import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ConversationV2PointerWriterService } from './conversation-v2-pointer-writer.service';
import { ConversationV2Session } from '../schemas/conversation-v2-session.schema';
import type { ConversationV2Event } from '../types/conversation-v2.types';

describe('ConversationV2PointerWriterService', () => {
  let svc: ConversationV2PointerWriterService;
  let updateOne: jest.Mock;

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
    await svc.apply('s1', ev('title', { title: 'My Run' } as any));
    expect(updateOne).toHaveBeenCalledWith(
      { sessionId: 's1' },
      { $set: expect.objectContaining({ title: 'My Run', lastEventAt: expect.any(Date) }) },
    );
  });

  it('DoneEvent flips status to completed', async () => {
    await svc.apply('s1', ev('done'));
    expect(updateOne).toHaveBeenCalledWith(
      { sessionId: 's1' },
      { $set: expect.objectContaining({ status: 'completed' }) },
    );
  });

  it('WaitEvent flips status to waiting', async () => {
    await svc.apply('s1', ev('wait'));
    expect(updateOne).toHaveBeenCalledWith(
      { sessionId: 's1' },
      { $set: expect.objectContaining({ status: 'waiting' }) },
    );
  });

  it('ErrorEvent flips status to error', async () => {
    await svc.apply('s1', ev('error', { error: 'boom' } as any));
    expect(updateOne).toHaveBeenCalledWith(
      { sessionId: 's1' },
      { $set: expect.objectContaining({ status: 'error' }) },
    );
  });

  it('MessageEvent only bumps lastEventAt', async () => {
    await svc.apply('s1', ev('message', { role: 'assistant', content: 'hi' } as any));
    expect(updateOne).toHaveBeenCalledWith(
      { sessionId: 's1' },
      { $set: { lastEventAt: expect.any(Date) } },
    );
  });

  it('swallows update errors (best effort)', async () => {
    updateOne.mockRejectedValueOnce(new Error('mongo down'));
    await expect(svc.apply('s1', ev('done'))).resolves.toBeUndefined();
  });
});
