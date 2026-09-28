import { newObjectId } from '@common/postgres';
import { WorkyPlanningService } from './worky-planning.service';
import type { WorkyMessageComponentRecord, WorkyMessageRecord, WorkyStreamRecord } from '../worky.types';

const ownerId = newObjectId();

const message = (over: Partial<WorkyMessageRecord>): WorkyMessageRecord => ({
  id: newObjectId(),
  streamId: newObjectId(),
  externalId: null,
  turnId: null,
  role: 'manager',
  content: '',
  planDeltaRef: null,
  emittedAt: null,
  origin: null,
  createdAt: new Date('2026-09-23T09:00:00Z'),
  updatedAt: new Date('2026-09-23T09:00:00Z'),
  ...over,
});

const component = (over: Partial<WorkyMessageComponentRecord>): WorkyMessageComponentRecord => ({
  id: newObjectId(),
  streamId: newObjectId(),
  externalId: null,
  messageExternalId: '',
  ordinal: 0,
  type: 'text',
  data: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...over,
});

function makeService(stream: Partial<WorkyStreamRecord> | null, repo: Record<string, jest.Mock> = {}) {
  const streams = { findById: jest.fn().mockResolvedValue(stream && { ownerUserId: ownerId, shares: [], status: 'active', ...stream }) };
  const messages = {
    create: jest.fn(),
    listRecent: jest.fn().mockResolvedValue([]),
    listComponents: jest.fn().mockResolvedValue([]),
    ...repo,
  };
  const events = { emit: jest.fn() };
  const service = new WorkyPlanningService(streams as never, messages as never, events as never);
  return { service, streams, messages, events };
}

describe('WorkyPlanningService.listMessages', () => {
  it('returns the newest limited window in chronological order with its components', async () => {
    const streamId = newObjectId();
    const planDeltaRef = newObjectId();
    const old = message({ externalId: 'old', role: 'owner', content: 'Old', createdAt: new Date('2026-09-23T09:00:00Z') });
    const local = message({ role: 'owner', content: 'Local', turnId: 'turn-1', createdAt: new Date('2026-09-23T09:30:00Z') });
    const recent = message({ externalId: 'new', content: 'New', planDeltaRef, createdAt: new Date('2026-09-23T10:00:00Z') });
    const { service, messages } = makeService({ id: streamId }, {
      listRecent: jest.fn().mockResolvedValue([old, local, recent]),
      listComponents: jest.fn().mockResolvedValue([
        component({ externalId: 'c-1', messageExternalId: 'new', ordinal: 0, type: 'choice', data: { questionId: 'confirm::new' } }),
        component({ externalId: 'c-2', messageExternalId: 'new', ordinal: 1, type: 'text', data: { text: 'more' } }),
        component({ externalId: null, messageExternalId: 'old', ordinal: 0, type: 'text', data: {} }),
      ]),
    });

    const result = await service.listMessages(ownerId, streamId, 3);

    expect(messages.listRecent).toHaveBeenCalledWith(streamId, 3);
    expect(messages.listComponents).toHaveBeenCalledWith(streamId, ['old', 'new']);
    expect(result).toEqual([
      { id: old.id, role: 'owner', content: 'Old', turnId: null, planDeltaRef: null, createdAt: '2026-09-23T09:00:00.000Z', components: [{ id: '', type: 'text', data: {} }] },
      { id: local.id, role: 'owner', content: 'Local', turnId: 'turn-1', planDeltaRef: null, createdAt: '2026-09-23T09:30:00.000Z', components: [] },
      {
        id: recent.id, role: 'manager', content: 'New', turnId: null, planDeltaRef, createdAt: '2026-09-23T10:00:00.000Z',
        components: [
          { id: 'c-1', type: 'choice', data: { questionId: 'confirm::new' } },
          { id: 'c-2', type: 'text', data: { text: 'more' } },
        ],
      },
    ]);
  });

  it('lets a read share list the messages', async () => {
    const reader = newObjectId();
    const { service, messages } = makeService({
      id: newObjectId(),
      shares: [{ id: newObjectId(), streamId: newObjectId(), userId: reader, permission: 'read', createdAt: new Date(), updatedAt: new Date() }],
    });

    await expect(service.listMessages(reader, newObjectId())).resolves.toEqual([]);
    expect(messages.listRecent).toHaveBeenCalledWith(expect.any(String), 200);
  });

  it('hides a stream the user cannot see as not found', async () => {
    const { service, streams, messages } = makeService({ id: newObjectId() });

    await expect(service.listMessages(newObjectId(), newObjectId())).rejects.toMatchObject({ code: 'ERR_3500' });
    await expect(service.listMessages(ownerId, 'not-an-id')).rejects.toMatchObject({ code: 'ERR_3500' });
    expect(streams.findById).toHaveBeenCalledTimes(1);
    expect(messages.listRecent).not.toHaveBeenCalled();
  });
});

describe('WorkyPlanningService.appendOwnerMessage', () => {
  it('stores the owner message and emits message.appended', async () => {
    const streamId = newObjectId();
    const stored = message({ role: 'owner', content: 'hi', turnId: 'turn-1', createdAt: new Date('2026-09-23T11:00:00Z') });
    const { service, messages, events } = makeService({ id: streamId }, { create: jest.fn().mockResolvedValue(stored) });

    const result = await service.appendOwnerMessage(ownerId, streamId, { content: 'hi', turnId: 'turn-1' });

    expect(messages.create).toHaveBeenCalledWith({ streamId, role: 'owner', content: 'hi', turnId: 'turn-1' });
    expect(events.emit).toHaveBeenCalledWith(ownerId, streamId, expect.objectContaining({
      type: 'message.appended',
      payload: { id: stored.id, role: 'owner', content: 'hi', turnId: 'turn-1' },
    }));
    expect(result).toEqual({ id: stored.id, content: 'hi', createdAt: '2026-09-23T11:00:00.000Z', turnId: 'turn-1' });
  });

  it('refuses messages on an archived stream', async () => {
    const { service, messages } = makeService({ id: newObjectId(), status: 'archived' });

    await expect(service.appendOwnerMessage(ownerId, newObjectId(), { content: 'hi' })).rejects.toMatchObject({ code: 'ERR_3509' });
    expect(messages.create).not.toHaveBeenCalled();
  });

  it('refuses a read-only share', async () => {
    const reader = newObjectId();
    const { service, messages } = makeService({
      id: newObjectId(),
      shares: [{ id: newObjectId(), streamId: newObjectId(), userId: reader, permission: 'read', createdAt: new Date(), updatedAt: new Date() }],
    });

    await expect(service.appendOwnerMessage(reader, newObjectId(), { content: 'hi' })).rejects.toMatchObject({ code: 'ERR_3500' });
    expect(messages.create).not.toHaveBeenCalled();
  });
});
