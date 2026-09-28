import { Test } from '@nestjs/testing';
import { ConversationV2EventStoreService } from './conversation-v2-event-store.service';
import {
  type ConversationV2EventStore, 
} from '../persistence/conversation-v2-event.store';
import type { ConversationV2Event as WireEvent } from '../types/conversation-v2.types';
import { PgConversationV2EventStore } from '../persistence/postgres/pg-conversation-v2-event.store';

const SESSION_HEX = '507f1f77bcf86cd799439011';

describe('ConversationV2EventStoreService', () => {
  let svc: ConversationV2EventStoreService;
  let store: jest.Mocked<Pick<ConversationV2EventStore, 'append' | 'listSince' | 'listByType' | 'tagModel'>>;

  beforeEach(async () => {
    store = {
      append: jest.fn(),
      listSince: jest.fn(),
      listByType: jest.fn(),
      tagModel: jest.fn(),
    };

    const mod = await Test.createTestingModule({
      providers: [
        ConversationV2EventStoreService,
        { provide: PgConversationV2EventStore, useValue: store },
      ],
    }).compile();

    svc = mod.get(ConversationV2EventStoreService);
  });

  function wire(type: WireEvent['type'], payload: Partial<WireEvent['payload']> = {}): WireEvent {
    return {
      type,
      payload: { event_id: 'e1', timestamp: 1700000000, ...payload },
    } as WireEvent;
  }

  it('append delegates to the event store and returns its result', async () => {
    const event = wire('message', {
      event_id: 'e1',
      role: 'assistant',
      content: 'hi',
    } as any);
    store.append.mockResolvedValueOnce({ sequence: 7, inserted: true });

    const result = await svc.append(SESSION_HEX, event);

    expect(result).toEqual({ sequence: 7, inserted: true });
    expect(store.append).toHaveBeenCalledWith(SESSION_HEX, event);
  });

  it('append returns inserted=false when the store reports a duplicate', async () => {
    store.append.mockResolvedValueOnce({ sequence: 3, inserted: false });

    const result = await svc.append(SESSION_HEX, {
      type: 'done',
      payload: { event_id: 'e1', timestamp: 1 },
    } as never);

    expect(result).toEqual({ sequence: 3, inserted: false });
    expect(store.append).toHaveBeenCalledTimes(1);
  });

  it('append propagates store errors (e.g. invalid session id)', async () => {
    store.append.mockRejectedValueOnce(new Error('Invalid session id'));
    await expect(svc.append('not-a-hex', wire('done'))).rejects.toThrow('Invalid session id');
  });

  it('listSince delegates to the event store', async () => {
    const rows = [
      {
        id: 'r1',
        sessionId: 's1',
        sequence: 5,
        eventId: 'e5',
        type: 'message' as const,
        emittedAt: 1,
        payload: {},
        modelId: null,
        createdAt: new Date(0),
      },
      {
        id: 'r2',
        sessionId: 's1',
        sequence: 6,
        eventId: 'e6',
        type: 'done' as const,
        emittedAt: 2,
        payload: {},
        modelId: null,
        createdAt: new Date(0),
      },
    ];
    store.listSince.mockResolvedValueOnce(rows);

    const result = await svc.listSince('s1', 4, 200);
    expect(store.listSince).toHaveBeenCalledWith('s1', 4, 200);
    expect(result).toEqual(rows);
  });

  it('listByType delegates to the event store', async () => {
    store.listByType.mockResolvedValueOnce([]);
    await svc.listByType(SESSION_HEX, 'message');
    expect(store.listByType).toHaveBeenCalledWith(SESSION_HEX, 'message');
  });

  it('tagModel delegates to the event store', async () => {
    store.tagModel.mockResolvedValueOnce(undefined);
    await svc.tagModel('s1', 'e1', 'azure/gpt-4.1');
    expect(store.tagModel).toHaveBeenCalledWith('s1', 'e1', 'azure/gpt-4.1');
  });
});
