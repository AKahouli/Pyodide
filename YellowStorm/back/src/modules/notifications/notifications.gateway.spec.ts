import { firstValueFrom, Subject } from 'rxjs';
import { NotificationsGateway } from './notifications.gateway';
import { toNotificationWire } from './persistence/notification.mapper';
import type { NotificationRecord } from './persistence/notification.store';

/**
 * Plan 1B.1.3 / R-18: the SSE payload the gateway pushes must be exactly the mapper's
 * wire object (what the Mongo schema's toJSON used to emit), and internal columns
 * (retryCount / lastError) must never reach the client.
 */
describe('NotificationsGateway SSE payload', () => {
  const logger = { setContext: jest.fn(), log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const config = { get: jest.fn((_key: string, fallback: unknown) => fallback) };

  const record: NotificationRecord = {
    id: '6ab107ddedbe1b3ff15d8026',
    userId: '6a82f48eff32bc6311c9c78d',
    type: 'info',
    title: 'Project shared',
    message: 'A project was shared with you',
    data: { projectId: 'p1' },
    actions: [{ label: 'Open', url: '/projects/p1' }] as NotificationRecord['actions'],
    destination: 'user',
    status: 'sent',
    sourceModule: 'project',
    priority: 'normal',
    expiresAt: new Date('2026-10-21T10:00:00.000Z'),
    extra: { shareId: 's1' },
    sentAt: new Date('2026-09-21T10:00:00.000Z'),
    readAt: null,
    retryCount: 3,
    lastError: 'boom',
    createdAt: new Date('2026-09-21T09:59:00.000Z'),
    updatedAt: new Date('2026-09-21T10:00:00.000Z'),
  };

  let gateway: NotificationsGateway;

  beforeEach(() => {
    gateway = new NotificationsGateway(logger as never, config as never);
  });

  afterEach(() => { gateway.onModuleDestroy(); });

  it('pushes exactly the mapper wire object to a connected user', async () => {
    const stream = gateway.registerConnection(record.userId!, 'conn-1', new Subject<void>())!;
    const received = firstValueFrom(stream);

    const wire = toNotificationWire(record);
    await expect(gateway.sendToUser(record.userId!, wire)).resolves.toBe(true);

    const event = await received;
    expect(event.type).toBe('notification');
    expect(JSON.parse(event.data as string)).toEqual(JSON.parse(JSON.stringify(wire)));
  });

  it('never serialises internal columns and keeps the Mongo-era shape', async () => {
    const stream = gateway.registerConnection(record.userId!, 'conn-1', new Subject<void>())!;
    const received = firstValueFrom(stream);
    await gateway.sendToUser(record.userId!, toNotificationWire(record));

    const payload = JSON.parse((await received).data as string);
    expect(payload).not.toHaveProperty('retryCount');
    expect(payload).not.toHaveProperty('lastError');
    expect(payload).not.toHaveProperty('_id');
    expect(payload.id).toBe(record.id);
    // Flat columns are rebuilt into the nested metadata object clients read.
    expect(payload.metadata).toEqual({
      sourceModule: 'project',
      priority: 'normal',
      expiresAt: '2026-10-21T10:00:00.000Z',
      extra: { shareId: 's1' },
    });
    // Dates are ISO strings on the wire; null columns are omitted, not sent as null.
    expect(payload.createdAt).toBe('2026-09-21T09:59:00.000Z');
    expect(payload).not.toHaveProperty('readAt');
  });

  it('returns false when the user has no open connection', async () => {
    await expect(gateway.sendToUser('someone-else', toNotificationWire(record))).resolves.toBe(false);
  });

  it('broadcast reaches every connection with the same payload', async () => {
    const a = firstValueFrom(gateway.registerConnection('u1', 'c1', new Subject<void>())!);
    const b = firstValueFrom(gateway.registerConnection('u2', 'c2', new Subject<void>())!);

    await gateway.broadcast(toNotificationWire({ ...record, userId: null, destination: 'broadcast' }));

    const [ea, eb] = await Promise.all([a, b]);
    expect(ea.data).toBe(eb.data);
    expect(JSON.parse(ea.data as string)).not.toHaveProperty('userId');
  });
});
