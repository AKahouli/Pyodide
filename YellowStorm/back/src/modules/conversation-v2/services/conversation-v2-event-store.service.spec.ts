import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ConversationV2EventStoreService } from './conversation-v2-event-store.service';
import { ConversationV2Session } from '../schemas/conversation-v2-session.schema';
import { ConversationV2Event } from '../schemas/conversation-v2-event.schema';
import type { ConversationV2Event as WireEvent } from '../types/conversation-v2.types';

const SESSION_HEX = '507f1f77bcf86cd799439011';

describe('ConversationV2EventStoreService', () => {
  let svc: ConversationV2EventStoreService;
  let sessionFindOneAndUpdate: jest.Mock;
  let eventUpdateOne: jest.Mock;
  let eventFind: jest.Mock;
  let eventFindOne: jest.Mock;

  beforeEach(async () => {
    sessionFindOneAndUpdate = jest.fn();
    eventUpdateOne = jest.fn();
    eventFind = jest.fn();
    eventFindOne = jest.fn();

    const mod = await Test.createTestingModule({
      providers: [
        ConversationV2EventStoreService,
        {
          provide: getModelToken(ConversationV2Session.name),
          useValue: { findOneAndUpdate: sessionFindOneAndUpdate },
        },
        {
          provide: getModelToken(ConversationV2Event.name),
          useValue: {
            updateOne: eventUpdateOne,
            find: eventFind,
            findOne: eventFindOne,
          },
        },
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

  it('append assigns next sequence and inserts an event row', async () => {
    sessionFindOneAndUpdate.mockReturnValueOnce({
      lean: () => ({ exec: () => Promise.resolve({ eventSequence: 7 }) }),
    });
    eventUpdateOne.mockResolvedValueOnce({ upsertedCount: 1 });

    const result = await svc.append(SESSION_HEX, wire('message', {
      event_id: 'e1',
      role: 'assistant',
      content: 'hi',
    } as any));

    expect(result).toEqual({ sequence: 7, inserted: true });
    expect(sessionFindOneAndUpdate).toHaveBeenCalledWith(
      { _id: new Types.ObjectId(SESSION_HEX) },
      { $inc: { eventSequence: 1, eventCount: 1 } },
      { new: true, projection: { eventSequence: 1 } },
    );
    expect(eventUpdateOne).toHaveBeenCalledWith(
      { sessionId: SESSION_HEX, eventId: 'e1' },
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          sessionId: SESSION_HEX,
          eventId: 'e1',
          sequence: 7,
          type: 'message',
          emittedAt: 1700000000,
        }),
      }),
      { upsert: true },
    );
  });

  it('append returns inserted=false and the existing row sequence on duplicate eventId', async () => {
    sessionFindOneAndUpdate.mockReturnValueOnce({
      lean: () => ({ exec: () => Promise.resolve({ eventSequence: 8 }) }),
    });
    // Upsert matched an existing row — Mongo did not insert.
    eventUpdateOne.mockResolvedValueOnce({ upsertedCount: 0, matchedCount: 1 });
    // append should fetch the existing row to learn its true sequence (3, not 8).
    eventFindOne.mockReturnValueOnce({
      lean: () => ({ exec: () => Promise.resolve({ sequence: 3 }) }),
    });

    const result = await svc.append(SESSION_HEX, { type: 'done', payload: { event_id: 'e1', timestamp: 1 } } as never);
    expect(result.inserted).toBe(false);
    expect(result.sequence).toBe(3);
    expect(eventFindOne).toHaveBeenCalledWith({ sessionId: SESSION_HEX, eventId: 'e1' });
  });

  it('append throws NotFoundException for a non-ObjectId-hex sessionId without hitting the DB', async () => {
    await expect(svc.append('not-a-hex', wire('done'))).rejects.toThrow('Invalid session id');
    expect(sessionFindOneAndUpdate).not.toHaveBeenCalled();
  });

  it('listSince returns events with sequence > since, sorted ascending, capped at limit', async () => {
    const rows = [
      { sessionId: 's1', sequence: 5, eventId: 'e5', type: 'message', emittedAt: 1, payload: {} },
      { sessionId: 's1', sequence: 6, eventId: 'e6', type: 'done', emittedAt: 2, payload: {} },
    ];
    const limit = jest.fn().mockReturnValue({
      lean: () => ({ exec: () => Promise.resolve(rows) }),
    });
    const sort = jest.fn().mockReturnValue({ limit });
    eventFind.mockReturnValueOnce({ sort });

    const result = await svc.listSince('s1', 4, 200);
    expect(eventFind).toHaveBeenCalledWith({ sessionId: 's1', sequence: { $gt: 4 } });
    expect(sort).toHaveBeenCalledWith({ sequence: 1 });
    expect(limit).toHaveBeenCalledWith(200);
    expect(result).toEqual(rows);
  });

  it('tagModel sets modelId on the row', async () => {
    eventUpdateOne.mockResolvedValueOnce({ matchedCount: 1 });
    await svc.tagModel('s1', 'e1', 'azure/gpt-4.1');
    expect(eventUpdateOne).toHaveBeenCalledWith(
      { sessionId: 's1', eventId: 'e1' },
      { $set: { modelId: 'azure/gpt-4.1' } },
    );
  });
});
