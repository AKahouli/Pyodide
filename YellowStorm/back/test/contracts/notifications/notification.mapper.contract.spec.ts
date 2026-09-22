import 'reflect-metadata';
import { expectContract } from '../expect-contract';
import { toWire, expectNoMongoKeys, expectNoKeys } from '../wire-helpers';
import { toNotificationWire } from '@modules/notifications/persistence/notification.mapper';
import type { NotificationRecord } from '@modules/notifications/persistence/notification.store';

const record: NotificationRecord = {
  id: '64b000000000000000000101',
  userId: '64b000000000000000000001',
  type: 'agent_shared',
  title: 'Agent shared with you',
  message: 'An agent was shared with you',
  data: { agentId: '64b000000000000000000201' },
  actions: [{ label: 'Open', url: '/agents/64b000000000000000000201' }],
  destination: 'in_app',
  status: 'sent',
  sourceModule: 'agent',
  priority: 'normal',
  expiresAt: new Date('2026-02-01T00:00:00Z'),
  extra: { origin: 'share' },
  sentAt: new Date('2026-01-01T00:00:00Z'),
  readAt: new Date('2026-01-02T00:00:00Z'),
  retryCount: 3,
  lastError: 'smtp down',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
};

describe('notification mapper contract', () => {
  it('matches the recorded wire shape and never leaks internals', () => {
    const body = toWire(toNotificationWire(record));
    expectContract('notifications/notification', body);
    expect(body.id).toBe(record.id);
    expect(body.metadata).toMatchObject({ sourceModule: 'agent', priority: 'normal' });
    expectNoMongoKeys(body);
    expectNoKeys(body, 'retryCount', 'lastError');
    expect(body).not.toHaveProperty('retryCount');
    expect(body).not.toHaveProperty('lastError');
  });

  it('omits unset optional columns instead of emitting nulls', () => {
    const body = toWire(
      toNotificationWire({ ...record, userId: null, data: null, expiresAt: null, extra: null, sentAt: null, readAt: null }),
    );
    for (const key of ['userId', 'data', 'sentAt', 'readAt']) expect(body).not.toHaveProperty(key);
    expect(body.metadata).not.toHaveProperty('expiresAt');
    expect(body.metadata).not.toHaveProperty('extra');
  });
});
