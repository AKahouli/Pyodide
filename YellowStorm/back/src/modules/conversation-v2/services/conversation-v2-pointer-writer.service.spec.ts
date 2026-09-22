import { Test } from '@nestjs/testing';
import { ConversationV2PointerWriterService } from './conversation-v2-pointer-writer.service';
import {
  CONVERSATION_V2_SESSION_STORE,
  type ConversationV2SessionStore,
} from '../persistence/conversation-v2-session.store';
import type { ConversationV2Event } from '../types/conversation-v2.types';

describe('ConversationV2PointerWriterService', () => {
  let svc: ConversationV2PointerWriterService;
  let applyPointerPatch: jest.MockedFunction<ConversationV2SessionStore['applyPointerPatch']>;
  const SESSION_HEX = '507f1f77bcf86cd799439011';

  beforeEach(async () => {
    applyPointerPatch = jest.fn().mockResolvedValue(undefined);
    const mod = await Test.createTestingModule({
      providers: [
        ConversationV2PointerWriterService,
        {
          provide: CONVERSATION_V2_SESSION_STORE,
          useValue: { applyPointerPatch },
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
    expect(applyPointerPatch).toHaveBeenCalledWith(
      SESSION_HEX,
      expect.objectContaining({ title: 'My Run', lastEventAt: expect.any(Date) }),
    );
  });

  it('DoneEvent flips status to completed', async () => {
    await svc.apply(SESSION_HEX, ev('done'));
    expect(applyPointerPatch).toHaveBeenCalledWith(
      SESSION_HEX,
      expect.objectContaining({ status: 'completed' }),
    );
  });

  it('WaitEvent flips status to waiting', async () => {
    await svc.apply(SESSION_HEX, ev('wait'));
    expect(applyPointerPatch).toHaveBeenCalledWith(
      SESSION_HEX,
      expect.objectContaining({ status: 'waiting' }),
    );
  });

  it('ErrorEvent flips status to error', async () => {
    await svc.apply(SESSION_HEX, ev('error', { error: 'boom' } as any));
    expect(applyPointerPatch).toHaveBeenCalledWith(
      SESSION_HEX,
      expect.objectContaining({ status: 'error' }),
    );
  });

  it('user MessageEvent sets status active', async () => {
    await svc.apply(SESSION_HEX, ev('message', { role: 'user', content: 'hi' } as any));
    expect(applyPointerPatch).toHaveBeenCalledWith(
      SESSION_HEX,
      expect.objectContaining({ status: 'active', lastEventAt: expect.any(Date) }),
    );
  });

  it('assistant MessageEvent only bumps lastEventAt', async () => {
    await svc.apply(SESSION_HEX, ev('message', { role: 'assistant', content: 'hi' } as any));
    expect(applyPointerPatch).toHaveBeenCalledWith(
      SESSION_HEX,
      { lastEventAt: expect.any(Date) },
    );
  });

  it('swallows update errors (best effort)', async () => {
    applyPointerPatch.mockRejectedValueOnce(new Error('postgres down'));
    await expect(svc.apply(SESSION_HEX, ev('done'))).resolves.toBeUndefined();
  });

  it('still delegates when sessionId is not a valid ObjectId hex (store may no-op)', async () => {
    await svc.apply('not-a-hex', ev('done'));
    expect(applyPointerPatch).toHaveBeenCalledWith(
      'not-a-hex',
      expect.objectContaining({ status: 'completed' }),
    );
  });
});
